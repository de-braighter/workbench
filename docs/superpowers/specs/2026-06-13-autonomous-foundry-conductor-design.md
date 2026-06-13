# Autonomous-Foundry: Conductor + ADR-Coordination — Design

- **Date:** 2026-06-13
- **Status:** approved (design); implementation pending (writing-plans)
- **Author:** orchestrator/claude-opus-4-8 (foundry-pool session redirected to design)
- **Supersedes intent of:** foundry spec §9 "Conductor daemon (deferred)"; amends the
  pool-eligibility rule "T2 = founder-launch-only".
- **Grounded in:** `docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md`
  (F1–F6) · `domains/foundry/src/{state,events,ops,store-lock,scope}.ts` ·
  `.claude/skills/{build-path,foundry-worker,foundry-pool}/SKILL.md`.

## 1. Context & telos (why this exists)

de Braighter is an **AI-dev-only company**: the AI does the development. The founder's
entire loop is three verbs:

1. **Drop inputs** — a masterplan / vision / charter for a product.
2. **Register coordinators** — start a session, register it as a *foundry coordinator*
   (conductor). That's the only launch act.
3. **Test & refine** — exercise the auto-built *first draft* and issue refining commands.

The end-state we are building toward: **one supreme kernel (the substrate)** plus an
**undetermined, growing set of sellable products that reuse the substrate** to "win all
the sexy features to model and run systems" (the digital-twin / inference / plan-tree
primitives). The **Foundry is the machine that builds those products on the substrate**.
This design closes the last gap between today's *hybrid-spawn* machine (the founder
hand-launches every worker session) and the telos (the founder registers coordinators and
the machine builds everything to the gates).

Everything between "drop the masterplan" and "decide the gates" must be automatic —
including ADR authoring. The two human touch-points that remain are **the masterplan** and
**the founder gates**.

## 2. Problem (the trigger)

A live diagnosis (2026-06-13) found the foundry **board/claim/gate fold is sound**, but the
**ADR dimension is a structural blind spot**:

- The ADR-229 EPD-FHIR PR (`specs#307`) was mistitled **"oncology O-2/B2"** when it is
  **O-4's** work — an item-attribution drift the foundry could not prevent.
- Earlier, O-1 and O-6.1 ran in parallel, both read `next-free-adr: 227`, and **both
  grabbed ADR-227** → a renumber + a comment-ref fix PR.

**Root cause:** the foundry's `scopesDisjoint` locks **code paths** across claims, but ADR
numbers live out-of-band in the specs `next-free-adr` register — a shared resource the
foundry has *zero* model of (`GATE_TYPES` contains an `'adr'` gate *label* and nothing
else). Parallel designer-first workers therefore allocate ADR numbers uncoordinated. This
is the exact bug class that *scales catastrophically* the moment a conductor fans out N
parallel T2 workers. **ADR-coordination is the load-bearing prerequisite for safe parallel
autonomy.**

## 3. Design overview

```
masterplan ─▶ /build-path ─────────▶ foundry queue ─▶ CONDUCTOR ────────▶ worker subagents ─▶ FOUNDER GATES
 (founder)    · reserves ADR #s        (event log;      (/foundry-conduct  (unchanged             greenlight
              · emits ADR-authoring    store-lock =      Workflow:          foundry-worker        architecture
                items + code items      the ONE          poll foundry_next  protocol:             adr
                w/ dependsOn edges)      arbiter)        →fan out 1 worker   claim→worktree→       ship
                                                          /disjoint item     build→wave→land→      ▲
                                                         →barrier→re-poll    release)              │
                                                         →next wave→…)            │                │
                                                                                  └ T2 → ship-gate ┘
                                                                                    blocked, NEVER auto-merges
```

Four components, one event-sourced spine. The foundry barely changes — its store-lock is
already fan-out-safe by construction; the conductor is a thin driver over the **existing**
MCP tools; the only new foundry code is one allocator op. The conductor is **fed continuously
by the pipeline-filler (Component E)**: when the queue empties, the filler replenishes it via
a three-tier ladder — continuation via `/build-path` for greenlit products (auto), the
green-desk sweep (Component D, auto), and new-product proposals via `product-strategist`
(founder-greenlight-gated). The machine truly idles only when all three tiers are exhausted.

## 4. Component A — ADR-coordination

Kill the 227/229 bug class **by construction**, not by review.

### A.1 New event + op (mirrors the claim pattern)
- **`foundry:AdrReserved.v1`** event. Payload:
  `{ adrNumber: int>0, itemId: string, repo: string }` (`repo` scopes the ADR namespace —
  specs repo vs a domain repo). Typed constructor in `events.ts` following the existing
  pattern; aggregate via a new `adrAggregateId(repo, adrNumber)` (`uuidv5('adr:'+repo+'#'+adrNumber)` — per-repo namespace) added to
  `scope.ts`.
- **`reserveAdr(deps, { itemId, repo, floor })`** — a **standalone op under the same
  `withStoreLock`** that already serializes `claim()` (atomicity comes from the shared
  mkdir-mutex, not from co-location with `queuePush`, so a standalone op is equally
  collision-proof and cleaner/composable — `/build-path` calls it per ADR-needing item):
  fold the log → `next = max(floor, maxReserved(repo) + 1)` → reject if `itemId` already
  bound → append `AdrReserved`. **Two parallel reservations cannot grab the same number**
  (the precise O-1/O-6.1 race, now impossible).

### A.2 The allocator seed
The foundry log only knows numbers *it* reserved; pre-existing ADRs (176, 226, …) are
invisible. So `reserveAdr` takes a **`floor`** = the live specs `next-free-adr`, which
`/build-path` reads once at decompose-time. The foundry allocates sequentially from the
floor and is the source of truth from there; the ADR-authoring item, when it merges, bumps
the specs register (as ADR PRs already do). Manual (non-foundry) ADRs must still consult
the register — out of scope to enforce here (noted in §9).

### A.3 Binding lives in an aggregate, not on the WorkItem (ADR-176-minimal)
The `adrNumber → itemId` binding lives in a new **`AdrReservation` aggregate** in
`DerivedState` (queryable: "is N taken? who owns it?"). The **WorkItem schema stays
untouched** — the human handle is the ADR-authoring item's id `<key>/ADR-<n>`. This honors
the foundry's "claims are rows, intelligence in the callers" ethos.

## 5. Component B — Foundry-writes-ADRs (ADR authoring as a queued item)

ADR authoring becomes a **first-class work item the conductor can fan out** — riding the
*existing* WorkItem + dependsOn model, **no new machinery**.

- `/build-path` (stage 4) gains: for each ADR the path needs, **reserve a number** (§A) and
  **emit a dedicated authoring item** `<key>/ADR-<n>` scoped to `layers/specs/adr/…`
  (disjoint from code items by *different repo*). Every code item that cites the ADR gets a
  `dependsOn: <key>/ADR-<n>` edge → `claimableItems.depsSatisfied` holds the code items
  unclaimable until the ADR item is released `done`. Today's prose-only "ADR needs" step
  (`build-path/SKILL.md:94-97`) is rewritten from *"list the ADRs"* to *"reserve a number
  per ADR and emit an authoring item bound to it."*
- The worker's designer-first step **consumes its item's reserved number** instead of
  reading `next-free-adr`, and **generates the ADR title from the binding** → the "O-2/B2"
  mislabel cannot recur.
- The step-8 disjointness proof is extended to include ADR-authoring items (trivially
  disjoint by repo); the dangling-`dependsOn` check guards that no code item's ADR
  dependency is ever dangling.

## 6. Component C — The conductor (Workflow-based)

A **Workflow** invoked via a thin **`/foundry-conduct`** skill — *invoking it IS registering
the session as a coordinator.*

### C.1 The wave loop
```
loop:
  candidates = foundry_next(limit 50)              # advisory, lock-free, priority-ordered, mutually-disjoint
  if candidates empty: report board; stop          # drained, or only gate-blocked items remain
  results = parallel(candidates.map(item =>         # one worker subagent per disjoint item
              () => worker(item)))                  # barrier: wait the wave
  # newly-unblocked items surface as deps release-`done`; re-poll
```
- Each worker subagent runs the **unchanged foundry-worker protocol** (claim → worktree →
  execute → quality floor + verifier wave → land → release). The conductor needs **zero
  collision logic** — the store-lock + atomic `claim()` arbitrate; claim races are expected
  and bounded-retried (re-fetch on `already claimed`/`scope overlap`).
- **Lean main context:** the conductor never holds derived state (it lives in the log);
  subagents hold the per-item work and return only terminal outcomes (prRef, release
  outcome). This is the founder's "keep main context lean."

### C.2 Concurrency guards (baked into every worker subagent prompt — from the subsystem map)
- **Unique worktree per claim** (`<repo>/.claude/worktrees/<slug>`); **forbid any git op in
  the shared root clone** (the wave-agent-stash incident is the proof case).
- `NX_DAEMON=false` per worker (worktree nx daemons lock the main clone's nx db).
- **Heartbeat for the whole build** under TTL; a lapsed claim's heartbeat-revival re-runs
  the overlap scan and *throws* if the scope was taken — so cadence must never lapse.
- **Pin `model:`** on long workers (subagent model-inheritance death orphans a claim).
- **Orphan cleanup tied to release** — on any release outcome, schedule worktree teardown
  (`git worktree list` authoritative → unlock+remove → verify PR LANDED before `branch -D`).
- **One `FOUNDRY_DATA_DIR`** across all workers (decoupling lock/log silently breaks the
  single-writer guarantee).
- Treat a `store lock timeout` as transient → bounded backoff; **never delete `.lock`**.

### C.3 Multi-coordinator safety
Several sessions may each register as a coordinator concurrently. The foundry store-lock +
atomic claim arbitration make this **safe by construction**: two coordinators dispatching
the same item → exactly one claim wins, the other re-fetches. Multiple coordinators = more
parallel capacity, no new coordination needed. (Optional v2: a lightweight
`ConductorRegistered`/heartbeat record so `foundry_status` can show active coordinators —
observability only, not required for correctness.)

### C.4 Warm worktree pool (throughput) — founder-requested

> **Implemented (2026-06-13, item B / slice 2.5).** Shipped as a tested module —
> `domains/foundry/src/wt-pool.ts` (pure `resetPlan`/`poolPaths`/`nextFreeSlot` +
> injected-`run` `ensureSlot`/`leaseSlot`, the reset-on-lease risk surface covered by a
> real-git integration test proving `node_modules` survives) + a thin
> `domains/foundry/src/wt-pool-cli.ts` (`npm run -s wt-pool -- lease <repoRoot> <branch>
> <slotIndex> [baseRef]`). The `foundry-worker` ISOLATE phase leases a slot, falling back
> to a cold `git worktree add` on any non-zero exit (**lease-or-cold-add** — the pool is
> throughput-only, never a correctness dependency). The lease is **single-coordinator**
> (assigning a slot to each fanned-out worker IS the lease); the multi-coordinator per-slot
> lease stays slice-3. `ensureSlot` **validates a slot is its own worktree root before
> reuse** — this prevents a `reset --hard` / `clean -fdx` escaping to the parent clone (the
> wave-caught hazard).

The dominant per-item cost is **`install` in a cold worktree** (a fresh `git worktree add`
has no `node_modules`): pnpm isolated-store linking + Windows MAX_PATH `.npmrc` + `prisma
generate` + postinstalls. A **per-repo warm pool** amortizes it:

- The conductor maintains **N warm worktrees per active repo** at stable paths
  `<repo>/.claude/wt-pool/slot-<i>`, each with `node_modules` populated. **Pool size per
  repo = the conductor's per-repo concurrency cap**, so *assigning a slot to each
  fanned-out worker IS the lease* — no separate lease primitive (single-coordinator case).
- **Slots persist on disk across sessions** → a later conductor session inherits the warm
  pool ("reused over multiple sessions sequentially").
- **Reset-on-lease is the one risk surface** (must be the most-tested code): preserve
  `node_modules`, make the tree pristine —
  `git fetch origin main` → `git checkout -B feat/<slug> origin/main` →
  `git clean -fdx -e node_modules -e .npmrc` → `git reset --hard origin/main` →
  `pnpm install --frozen-lockfile` (fast no-op unless the lockfile drifted). The prior
  branch's commits are already on its pushed PR, so discarding the local branch is safe.
- **Bounds disk** (N slots vs unbounded orphan sprawl) and fixes a short MAX_PATH-safe path.
- **Correctness is unchanged** — the foundry still arbitrates *scope* (paths), not
  worktrees; the pool is purely physical-isolation reuse. pnpm's warm global store already
  softens cold installs, so the conductor works **without** the pool (just slower per item)
  — the pool is a throughput layer, not a correctness requirement.

### C.5 Autonomous mode (Agent-loop, auto-merge, continuous)

#### Substrate rationale

Autonomous mode runs as an **Agent-loop in the session** — NOT via the Workflow tool.
Three constraints make this necessary:

1. **Workers must self-wave.** A Workflow `agent()` node is a leaf with no `Agent`/`Task`
   spawn primitive (verified 2026-06-13). Regular `Agent`-tool subagents carry the `Agent`
   tool and can fan out children. Autonomous workers are regular `Agent` subagents; they run
   their own `reviewer + qa-engineer + charter-checker` wave internally and return a
   `waveVerdict`. Workflow workers cannot.
2. **Async founder-gate wait.** The conductor polls `foundry_gate_decide` across multiple
   turns (hours between request and approval). A Workflow cannot suspend across turns.
3. **Runs until context-critical.** The loop iterates over an evolving frontier and must
   detect its own context budget. A session can; a Workflow cannot.

Preview and build modes stay Workflow-based (bounded, deterministic, journaled, resumable).
Autonomous is session-based (continuous, auto-merge, async-gate-aware, workers-self-wave).

#### The loop

```
ON STARTUP — RECOVERY PASS (FIRST step, before the main loop):
  PRIMARY: call foundry_status → read the 'BUILT (awaiting merge)' section.
    Each listed item carries { itemId, prRef } natively — no reconstruction needed.
    For each: rebind { itemId, prRef, waveVerdict: 'unknown'|<prior>, gate: 'ship'|'none' }
    into the awaiting-merge set. A built-but-unmerged item IS recognized; it is NEVER re-built.
  BACKSTOP (defense-in-depth): gh pr list --state open for each active repo
    → match open PRs on feat/<slug> branches not already in the set
    → add { itemId, prRef, waveVerdict: 'unknown', gate } for any gaps.
  Stateless restart is TRUE: the awaiting-merge set is rebuilt from the foundry log's
  built items (exact), with gh open PRs as backstop (defense-in-depth).

loop (until context-critical OR idle-stop):
  a. POLL: foundry_status + foundry_next(limit 50) — lock-free, advisory

  b. MERGE PASS — for each PR in awaiting-merge set (including RECOVERY PASS entries):
       CHECK GATE (fail-closed — item-bound):
         call foundry_gate_status { productKey: <item's productKey> }
         Find the gate(s) the item requires: 'ship' (T2 mandatory); 'adr' (new port/primitive).
         A gate is APPROVED for THIS ITEM iff its returned record has decision === 'approved'
         AND its payloadRef references THIS item (contains the itemId or the prRef).
         FAIL CLOSED: any required gate that is pending, rejected, absent, or whose
         payloadRef does NOT reference this item → NOT approved → DO NOT MERGE.
         INVARIANT: a sibling item's approved gate NEVER authorizes merging this item —
         match by payloadRef FIRST, then check decision.
         foundry_status shows only pending gates; absence from pending ≠ proof of approval.
         foundry_gate_status is the authoritative source.
       if waveVerdict == 'green' AND foundry_gate_status shows every required gate approved
          with payloadRef matching THIS item (or T0/T1 = no gate):
         gh pr merge --admin (squash)
         → VERIFY MERGED: gh pr view <pr> --json state must equal MERGED before proceeding
         → twin ritual (drain → backfill → reconcile)
         → foundry_record_merge { itemId, prRef }   ← terminalizes built → done
         → worktree cleanup (after VERIFIED-merged)
       if T2 gate not approved (foundry_gate_status decision ≠ 'approved' OR no gate with
          matching payloadRef): leave in set; re-check next pass.
       INVARIANT: T2 is NEVER merged without foundry_gate_status showing decision:'approved'
                  for a gate whose payloadRef references THIS item's 'ship' gate (+ 'adr'
                  gate if new port/kernel primitive). A sibling item's approval is NOT sufficient.
                  Cleanup NEVER runs before gh pr view confirms state === MERGED.

  c. DISPATCH PASS — for each claimable item NOT in awaiting-merge set (cap = maxWorkers):
       Agent({ worker in autonomous mode:
               claim → worktree → build → ci:local
               → OWN verifier wave (reviewer + qa-engineer + charter-checker,
                  + exercir-charter-checker if repo=domains/exercir)
               → post-findings → open PR
               → T2: WORKER issues
                     foundry_gate_request{ productKey, gateType:'ship', payloadRef:'<itemId>|<prRef>' }
                     (+ second call with gateType:'adr' if new port/kernel primitive)
                     — WORKER OWNS THIS; payloadRef binds the gate to THIS item
                     release built (prRef persisted natively)
               → T0/T1: release built (prRef persisted natively)
               → RETURN { itemId, prRef, waveVerdict, blockingCount, gate, outcome } })
       add returned item to awaiting-merge set
       NOTE: conductor NEVER issues gate requests — it only reads log + merges after approval

  d. IDLE CHECK: if nothing dispatched AND awaiting-merge empty → bounded backoff → filler:
       TIER 1 (greenlit-predicate): call foundry_gate_status { productKey: <product> }
         → find a gate with gateType:'greenlight' AND decision:'approved'.
         Filler MUST NOT act on non-greenlit products. Do NOT grep the event log —
         foundry_gate_status is the authoritative gate-decision source.
       TIER 2 (bounded): suppressed per repo until a merge changes it; per-cycle cap (10
         items default). Green-desk cannot livelock — a clean repo is never re-swept.
       TIER 3 (founder-gated): product-strategist surfaces proposals → STOP-FOR-FOUNDER.
       TRUE IDLE (real, reachable): all three tiers produced no new work in a full cycle.
         STOP: "Conductor idle — no unbuilt epics, no repo debt, no greenlit proposals."
         Context-critical is the BACKSTOP; true idle fires first.

  e. CONTEXT CHECK: if near context-critical → STOP; report awaiting-merge set +
       pending gates + stop reason
```

#### The merge rule (inviolable boundary)

Merge fires if and only if **both** hold: (i) **review is done** = `waveVerdict = 'green'`
(zero blocking/critical findings from the worker's own wave); (ii) **gate check passes
(item-bound)** = `foundry_gate_status { productKey }` returns `decision: 'approved'` for
every gate the item requires AND whose `payloadRef` references THIS item. FAIL CLOSED: any
required gate that is `pending`, `rejected`, absent, or whose `payloadRef` does not reference
this item → not approved → DO NOT MERGE. A sibling item's approved gate NEVER authorizes
merging this item.

After a successful merge:
- **Verify** — `gh pr view <pr> --json state` must return `MERGED` before any cleanup.
- **Twin ritual** — drain → backfill → reconcile.
- **`foundry_record_merge { itemId, prRef }`** — terminalizes the built item to done.
- **Worktree cleanup** — only after VERIFIED-merged.

- **T0 / T1**: no per-item founder gate → merge on green wave alone.
- **T2**: mandatory `ship` gate; mandatory `adr` gate when a new port/kernel primitive is
  introduced. The **WORKER** issues
  `foundry_gate_request { productKey, gateType: 'ship', payloadRef: '<itemId> | <prRef>' }`
  (+ a second call with `gateType: 'adr'`) at build time and releases `built` (prRef persisted
  natively); the **CONDUCTOR** calls `foundry_gate_status`, matches the gate by `payloadRef`
  to THIS item, and performs the merge only when every required item-bound gate is `approved`,
  then calls `foundry_record_merge` to terminalize. **The conductor NEVER merges a T2 PR
  without `foundry_gate_status` showing `decision:'approved'` for a gate whose `payloadRef`
  references THIS item; it also NEVER issues gate requests itself.** A sibling item's approved
  gate is NOT sufficient. Gates are non-blocking across products.

#### Context-critical stop and stateless restart (TRUE — proven by the RECOVERY PASS)

The conductor's durable state is rediscovered from two sources on startup:
  (a) The **foundry log's `built` items** — `foundry_status`'s `BUILT (awaiting merge)`
      section lists each built item + its `prRef` natively (exact, no reconstruction).
  (b) **GitHub open PRs** (`gh pr list`) — backstop for PRs opened before a built-release
      landed; feat/<slug> branch matching fills any gaps.

Both are durable; the in-context awaiting-merge set is just a cache the RECOVERY PASS
rebuilds. Stateless restart is **true in practice**: a fresh conductor runs the RECOVERY
PASS, rebuilds the awaiting-merge set from the foundry's built items (exact) + gh backstop,
and continues exactly where the previous conductor left off — no handoff, no serialization,
no leader-election. A built-but-unmerged PR is never re-built.

## Component C′ — The superconductor tier (fan-out capability matrix)

> **Implemented (2026-06-13, item D).** Shipped as the **`/foundry-superconduct` skill**
> (`.claude/skills/foundry-superconduct/SKILL.md`) — an **Agent-loop session** (the fan-out
> matrix below forbids a Workflow: a hierarchy needs three levels of fan-out, and a Workflow
> `agent()` node is a leaf). Resolved decisions:
> - **Lanes partitioned by product** — one `/foundry-conduct`-autonomous conductor subagent per
>   `productKey` (each greenlit product + each synthetic `green-desk-<repo-slug>` debt product is
>   a lane); cross-product items are disjoint by repo/scope, intra-product disjointness +
>   `dependsOn` is build-path's contract.
> - **Lean context** — the superconductor holds only per-conductor **summaries**
>   (`{ productKey, built, merged, awaitingGate, idle, stopReason }`), never per-item / per-worker
>   detail.
> - **Pipeline-filler runs ONCE at the top** (not per-conductor) so `product-strategist` runs
>   once; the conductor lanes never invoke the filler.
> - **Inviolable boundaries are enforced at the conductor leaves and NEVER relaxed by the
>   superconductor** — it reuses the `/foundry-conduct` merge rule rather than re-deriving it (T2
>   never auto-merges without an item-bound `approved` ship gate matched by `payloadRef`; new
>   products always STOP-FOR-FOUNDER). The superconductor is pure orchestration — it never claims,
>   merges, or requests/approves gates.
> - **Multi-superconductor safety is free** from the single foundry store-lock; v1 assumes one
>   superconductor.

Empirically verified 2026-06-13:

| Execution context | Can fan out sub-agents? |
|---|---|
| **Regular `Agent`-tool subagent** | **YES** — the `Agent` tool is in its own toolset; spawns children freely (recursively) |
| **Workflow `agent()` node** | **NO** — a leaf; its toolset has no `Agent`/`Task` spawn primitive |

**Consequence — a hierarchy is possible, but only via the `Agent` tool, never via Workflows.**
A **superconductor** is an `Agent`-loop session that dispatches **conductor** subagents (regular
`Agent` subagents — they keep the `Agent` tool), each dispatching **worker** subagents, each able
to run **its own verifier wave**: `superconductor → conductors → workers → wave-agents`, every
level fanning out the next.

- **Multiplicative parallelism:** `N` conductors × `M` workers = `N×M` concurrent builds
  (one conductor per product/lane).
- **Lean context at every level:** each tier holds only the tier-below's *summaries* — the
  founder registers ONE superconductor and it drains the whole foundry.
- **Collision-safe by construction at any depth:** every claim anywhere in the tree goes through
  the single foundry store-lock — the same arbitration that makes multi-coordinator safe makes
  multi-conductor safe, with zero extra machinery. The hierarchy is pure orchestration +
  context-isolation; correctness lives at the leaves.

**Substrate trade-off (revisits D1):** the **Workflow** conductor (slice 2) is flat + deterministic
+ resumable — a single-frontier drain. The **superconductor tier wants the `Agent`-loop substrate**
(recursive, model-driven, no journaling). The slice-2 scout→fan-out *logic* ports directly; only the
orchestration primitive changes. **Path:** slice 2 = Workflow leaf-unit (shipped); the superconductor
+ `Agent`-loop conductor is **shipped (item D, 2026-06-13 — see the "Implemented" note above)**:
the superconductor reuses the **autonomous** conductor (itself an `Agent`-loop), one per product
lane. The **warm worktree pool** (§C.4 / slice 2.5, item B) is **shipped (2026-06-13)** and
composes orthogonally — conductors' workers lease pool slots, lease-or-cold-add.

## Component D — Periodic green-desk sweep (maintenance workstream)

A *second work source* for the conductor, alongside `/build-path`: a **periodic sweep that
drives every repo to a "fully green desk"** — zero outstanding debt on every dimension, with
test coverage the sole "higher-is-better" exception. (Founder-requested, 2026-06-13.)

> **Implemented (2026-06-13, item C).** Shipped as the **`/green-desk` skill**
> (`.claude/skills/green-desk/SKILL.md`) + the ledger layout
> (`docs/foundry/green-desk/README.md`). Resolved decisions, each forced by a verified
> foundry-kernel fact:
> - **Synthetic `green-desk-<repo-slug>` product per swept repo** — forced by `toNextItem`
>   (`domains/foundry/src/ops.ts`) reading `repo`/`riskTier`/`priority` from the PRODUCT,
>   not the item scope; a multi-repo product would mislabel every item's repo. Each carries
>   T0 + low priority (200) so product work always outranks debt.
> - **Path-area partition** (one `debt-<area>` item per area, fixing all dimensions there) —
>   forced by `scopesDisjoint`: lint/knip/tsc over the same files are not path-disjoint, so a
>   per-dimension partition would overlap. Partition is proven disjoint with the same test
>   `/build-path` step 8 runs.
> - **git-HEAD repo-suppression** — derived from `git rev-parse origin/main` vs a
>   `lastSweptCommit` in a per-repo ledger file, keeping the foundry kernel ADR-176-minimal
>   (repo-suppression has a single consumer → it adds no foundry event).
> - **native-ignore + audit-ledger FP suppression** + the **no-new-progress stop** (§9.7).
> The conductor's tier-2 filler (Component E.2) invokes the skill; the skill owns the
> anti-livelock mechanism (the conductor wiring only points at it).

### D.1 The green-desk target
A repo is **green** when a fresh scan shows the best-possible value on every dimension:
- **Drive to 0:** lint (audit set), knip (dead code/exports), `tsc` type errors, Sonar
  bugs / vulnerabilities / security-hotspots / code-smells / duplications, cognitive-
  complexity violations, **every open verifier finding including `nit`/`note`**, and
  TODO/FIXME/HACK debt markers.
- **Coverage** — the one "higher-is-better" metric: **floor 80%, target 90%** (never 0).
- **Mutation** — coverage-like; kept at/above the tier floor, prefer higher.
- **False positives are SUPPRESSED-WITH-JUSTIFICATION, not chased.** "Green" = 0 *real* debt;
  a verified FP (e.g. knip's declaration-emit-types / prisma-generate-dep classes, F5
  runbook) gets a documented, reviewed suppression — never a silent ignore, never an
  infinite fix-loop.

### D.2 The debt-path generator (analogous to build-path)
For a target repo, scan all dimensions (the quality-floor gates + Sonar + the devloop twin's
unresolved-findings backlog + a TODO grep) and emit **disjoint-scoped cleanup work items**
(`green-desk-<repo-slug>/debt-<area>-<sha7>`, under a synthetic `green-desk-<repo-slug>` T0
product) to the foundry queue — pathPrefix'd by area so the conductor parallelizes them. Each
item names its dimension(s) + offending locations. *(Implemented — see the §D "Implemented" note.)*

### D.3 Dispatch + loop-until-green
The conductor fans out cleanup workers (same wave-loop); each routes through the existing
**`/tech-debt`** skill + the quality floor, fixes its scoped debt, lands a PR. After a wave,
**re-scan**; if any dimension is still above target, generate the next round
(loop-until-green, bounded by a **no-new-progress** stop so FPs can't loop it forever).

### D.4 The nit-deferral counterweight
The structural counterweight to per-PR nit-deferral: product PRs stay fast (defer
`nit`/`note` for velocity); the periodic sweep **guarantees deferred nits never accumulate**.
A ratchet, not a gate.

### D.5 Periodic trigger
A **configurable cadence** (per-sprint / weekly / after N product merges) via a scheduled
routine that registers a coordinator in **green-desk mode**, or a green-desk wave the
conductor runs when no product work is pending. Cadence + repo scope are parameters, never
hardcoded. Depends on the conductor (slice 2).

## Component E — Pipeline-filler (never idle)

The pipeline-filler **closes the foundry loop**: the conductor consumes items from the
bottom of the queue; the filler feeds the top. When the autonomous conductor's IDLE CHECK
finds the pipeline empty (nothing claimable, nothing awaiting merge), instead of stopping it
invokes the filler's **priority ladder**:

### E.1 Tier 1 — Continuation (AUTO — no new founder gate)

For each already-**greenlit** product whose charter has unbuilt epics, run `/build-path` to
decompose and emit the next wave of work items (including ADR-reservation via Component A
for any ADR-needing items, and `dependsOn` edges so the conductor fans out safely). This is
within the existing greenlight — the product was approved when the conductor started building
it; `/build-path` only emits NEW itemIds and is idempotent on existing items.

**Greenlit predicate (machine-checkable):** A product is greenlit when
`foundry_gate_status { productKey: <product> }` returns a gate with
`gateType: 'greenlight'` AND `decision: 'approved'` (or the product's charter status is
`approved`). Use `foundry_gate_status` — NOT an event-log grep. All gate-decision checks
(ship / adr / greenlight) use `foundry_gate_status`; no event-log grep remains for gate
decisions. A filler MUST NEVER widen its mandate to a non-greenlit product.

**Gate: none.** The product is already greenlit.

If new items appear after Tier 1, the conductor continues the main loop immediately without
descending to Tier 2 or 3.

### E.2 Tier 2 — Green-desk maintenance (AUTO — within standing mandate)

Invoke the **`/green-desk` skill (Component D — implemented)**: scan all active repos across
every debt dimension (lint, knip, `tsc` errors, Sonar bugs / smells / duplications, coverage
below 80%, open verifier nits, TODO markers) and emit disjoint-scoped cleanup items
(`green-desk-<repo-slug>/debt-<area>-<sha7>`) to the foundry queue. Driving existing repos to
a clean desk is part of the standing build mandate — no new authorization is needed.

**Gate: none.** Green-desk maintenance is within the mandate granted when the conductor was
registered.

**Anti-livelock (bounded filler):** Tier 2 is suppressed for a given repo until a merge
has changed that repo since the last sweep. A per-cycle work-item cap (default 10) further
bounds token consumption; the filler yields at the cap and continues on the next IDLE CHECK.
Green-desk can never livelock — a clean repo is never re-swept, and the cap prevents
unbounded burn on debt that can't be immediately resolved.

If cleanup items appear (within cap) after Tier 2, the conductor continues the main loop
immediately without descending to Tier 3.

### E.3 Tier 3 — New-product / new-feature proposals (FOUNDER-GREENLIGHT-GATED)

Run the **`product-strategist` agent** to surface 2–3 ranked candidate next-features or
new products from the masterplan, product-ideas backlog, and retros. The agent synthesizes
(it does not invent), producing a prioritized proposal block.

**Gate: MANDATORY — Gate 1 (greenlight).** The conductor SURFACES the proposals to the
founder and enters a **STOP-FOR-FOUNDER** state. It **NEVER** auto-charters or auto-builds
a new product. A new product is NEVER started without an explicit founder greenlight.

On a founder greenlight, the dossier→brief→charter→`/build-path` pipeline fills the queue
and the conductor resumes from Tier 1 on the next pass.

### E.4 Gate boundary (inviolable)

| Tier | Action | Gate |
|---|---|---|
| 1 — Continuation | `/build-path` emits next epics for greenlit products | **None** — within existing greenlight |
| 2 — Green-desk | Component D sweep emits cleanup items | **None** — within standing mandate |
| 3 — New product | `product-strategist` surfaces proposals | **Gate 1 (greenlight) — ALWAYS waits for founder** |

A new product is **NEVER auto-built.** The conductor surfaces, explains, and waits for an
explicit founder greenlight before any charter or `/build-path` run for a new product.

### E.5 True idle (all three tiers exhausted — real, reachable termination)

The machine truly idles — and stops cleanly — only when all three tiers produced NO NEW
WORK in a complete pass:
- No unbuilt epic exists on any greenlit product (Tier 1 empty), AND
- No unsuppressed repo has debt above the green target (Tier 2 empty or fully suppressed),
  AND
- The founder has not greenlit any proposal from the Tier 3 surface (Tier 3 gated or no
  proposals exist).

Stop message: `"Conductor idle — no unbuilt epics, no repo debt, no greenlit proposals.
Re-launch after a masterplan input or greenlight."`

**True idle is the primary stop condition.** Context-critical is the backstop (emergency
stop when context budget is exhausted mid-cycle) — not the only stop. A well-configured
conductor reaches true idle before hitting context-critical on a finite workload.

### E.6 Reuse map

- **Tier 1** reuses: `/build-path` skill (unchanged; called per-product).
- **Tier 2** reuses: Component D (green-desk debt-path generator + `/tech-debt` routing +
  loop-until-green); see §D.2–D.3.
- **Tier 3** reuses: the `product-strategist` agent (read-only survey; never opens issues or
  emits queue items directly).

## 7. The autonomy boundary (the founder's control surface)

**Dropped — "T2 = founder-launch-only."** Pool/conductor workers may now self-serve T2
items. This deletes the gnarliest open question ("how does a conductor get per-item T2
launch authorization") — authorization moves entirely to the gates. Skill edits:
`foundry-worker/SKILL.md` Phase 0 eligibility + `foundry-pool/SKILL.md` invariants remove
the T2/`founder-launch-only` skip.

**Kept, inviolable — the four founder gates.** They are the *real* governance, and dropping
launch-only makes them load-bearing:
- **T0/T1** auto-merge on a green wave (+ Sonar for T1).
- **T2** builds to its `ship` gate, releases **`built`** (prRef persisted natively), and
  NEVER auto-merges. Designer-first + every kernel-touching `adr` gate remain mandatory.
- Gates are **non-blocking across products** — one parked gate never stalls other lanes;
  the conductor keeps fanning out eligible items elsewhere.

Why this is *stronger*, not looser: a T2 build is inert in an isolated worktree/PR until it
crosses a gate. Controlling **what ships** (the gate) dominates controlling **what starts
building** (the launch). Regulated safety is preserved by the gates + the per-item T2
quality floor (synthetic-no-real-PHI, §11 survival gate, assert-non-superuser, mutation-T2),
not by the launch restriction.

## 8. Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Conductor substrate | **Two substrates by mode:** Workflow tool (preview + build); Agent-loop session (autonomous) | **Workflow** (preview/build): native fan-out, deterministic, journaled + resumable, store-lock-safe, bounded per invocation. Workers are Workflow leaves — cannot self-wave. **Agent-loop** (autonomous): continuous, auto-merge on review-done + gates-green, workers are regular `Agent` subagents that DO self-wave, conductor waits async for founder gates across passes, stops at context-critical + restarts stateless. v2 = external daemon for 24/7 cross-session running. *(founder-approved; autonomous tier added 2026-06-13)* |
| D2 | ADR binding location | **`AdrReservation` aggregate** | Queryable allocator state; WorkItem schema stays ADR-176-minimal. |
| D3 | Reservation timing | **Decompose-time, standalone `reserveAdr` op under the shared store-lock** | Atomicity comes from the shared mkdir-mutex (not co-location with `queuePush`); cleaner/composable, `/build-path` calls it per ADR-needing item. Number stays stable across re-claim/handoff. |
| D4 | ADR repo | **specs repo (`layers/specs/adr/`)** for kernel/cross-cutting ADRs | Current practice; ADR item spans two repos vs code items → trivially disjoint by repo. |
| D5 | Gate autonomy | **Gates stay; T2 never auto-merges; launch-only dropped** | §7. *(founder-confirmed)* |
| D6 | Per-item TTL | **Conductor sizes a finite, build-appropriate TTL + heartbeats** | Long enough to exceed the build, finite so a dead worker frees the item. |

## 9. Open questions (resolve during build; none block slice 1)

**Resolved (shipped foundry#4 — 2026-06-13):**
- ~~`foundry_gate_status` MCP read op~~ — **DONE.** The conductor now calls
  `foundry_gate_status { productKey }` directly for ALL gate decisions (ship, adr, and
  greenlight). No event-log grep for gate decisions remains anywhere. Gate lookup is
  **item-bound via `payloadRef`**: the worker stamps `payloadRef: '<itemId>|<prRef>'` in
  `foundry_gate_request`, and the conductor matches gates by `payloadRef` before treating
  them approved — a sibling item's approved gate cannot authorize merging this item (fail-OPEN
  closed).
- ~~`built` release outcome persisting `prRef` in the foundry log~~ — **DONE.** Workers
  release `foundry_release { outcome: 'built', prRef }` natively; the RECOVERY PASS reads
  the `BUILT (awaiting merge)` section of `foundry_status` directly (exact, no reconstruction).
  `foundry_record_merge { itemId, prRef }` terminalizes built → done after conductor merge.

**Open:**

1. **ADR namespace per repo** — `reserveAdr` keys "next free" by `repo`; manual non-foundry
   ADRs are still uncoordinated (acceptable; the foundry owns foundry-driven ADRs).
2. **Reclaim policy for an abandoned reservation** — if an ADR item is released `abandoned`,
   is the number reclaimed or burned? Default: **burned** (numbers are cheap; reclaim adds
   fold complexity).
3. **Orphan-reconcile op** — should the foundry gain an explicit op to recover a stranded
   commit/worktree on a stale claim, or does the conductor handle recovery out-of-band?
   Default v1: **conductor-side** recovery pass over `staleClaims`.
4. **Coordinator-presence observability** — optional `ConductorRegistered` record (§C.3).
5. **Multi-ADR items** — current model is 1 item ↔ 1 ADR; an epic touching several ADRs
   decomposes into multiple ADR-authoring items (no `number[]` needed).
6. **Warm pool reset robustness + warm-up** (§C.4) — the reset-on-lease must be proven
   pristine-preserving-`node_modules` (the corruption risk); first-fill of a slot still pays
   one cold install; multi-coordinator pool-sharing needs a per-slot lease (slice 3).
7. **Green-desk FP-suppression ledger + stop condition** (§D) — **RESOLVED (2026-06-13,
   item C).** Reviewed false-positive suppressions live as **native per-tool ignore + an
   audit row** in `docs/foundry/green-desk/fp-ledger.md` (`| date | repo | tool | path | rule
   | justification | reviewer |`) — never silent; `/green-desk` step 5 reads the ledger so a
   suppressed offense is never re-emitted. The loop's stop condition is **no-new-progress**:
   after 2 consecutive **genuine re-sweeps** — each admitted only when `origin/main` HEAD has
   **moved** AND the prior sweep's emitted items have resolved — show no offense-count
   reduction, the repo's debt is surfaced as "stuck" (needs an FP row or a founder decision)
   rather than looped. (The counter trips independent of HEAD, so the stop is reachable; the
   earlier "unchanged-HEAD" framing was self-contradictory and is corrected here.)
8. **Green-desk cadence/scope + mutation target** (§D.5/D.1) — **RESOLVED (2026-06-13,
   item C).** Cadence = the conductor's IDLE **tier-2** (primary, event-driven and
   suppression-bounded) + on-demand `/green-desk <repo>` / `--all` + an optional scheduled
   `CronCreate` wrapper. Scope (`--all`) = the cluster repos enumerated **from the
   filesystem** — real clone roots only (a `.git` _directory_ with a `de-braighter/*`
   origin), which skips orphaned worktree/scratch siblings; **not** read from `foundry_status`
   (its board has no `repo`). Mutation stays **coverage-like at the tier floor** (prefer
   higher), with **no separate hard target**.

## 10. Build slices (one spec → three slices)

- **Slice 1 — ADR-coordination + ADR-as-item (Components A + B).** Foundry: `AdrReserved`
  event/op/aggregate + `adrAggregateId`. build-path: reserve numbers + emit ADR-authoring
  items + dependsOn edges + rewritten step 5/8. foundry-worker: consume reserved number.
  *The prerequisite that makes parallel T2 safe.* Foundry change = a PR on `domains/foundry`
  (verifier wave); skill changes = workbench declarative edits.
- **Slice 2 — The conductor (Component C) + drop T2-launch-only.** `/foundry-conduct` skill +
  the Workflow script (fresh worktree per worker); concurrency guards; skill eligibility
  edits.
- **Slice 2.5 — Warm worktree pool (§C.4). DONE (2026-06-13, item B).** Per-repo warm pool
  with bulletproof reset-on-lease, shipped as the tested `domains/foundry/src/wt-pool.ts`
  module (+ `wt-pool-cli.ts`); `foundry-worker` ISOLATE leases a slot, lease-or-cold-add
  fallback. Single-coordinator lease (multi-coordinator per-slot lease stays slice-3).
  Throughput layer; correctness never depends on it.
- **Slice 3 (later) — refinements.** Orphan-reconcile op, gate-aware board reporting,
  coordinator-presence record, per-item TTL policy, multi-coordinator pool-lease.
- **Slice 4 — Periodic green-desk sweep (Component D). DONE (2026-06-13, item C).** Shipped
  the `/green-desk` debt-path generator (per-repo multi-dimension scan → disjoint path-area
  cleanup items) + the green-desk target check + `/tech-debt` worker routing + loop-until-green
  bounds + the FP-suppression ledger + the cadence wrapper. Reuses the devloop twin + Sonar +
  the F5 quality floor. Depends on the conductor (slice 2).
- **Slice 5 — Pipeline-filler (Component E).** Wire the three-tier filler into the
  autonomous conductor's IDLE CHECK (step d): Tier 1 `/build-path` continuation call per
  greenlit product; Tier 2 Component-D green-desk sweep invocation; Tier 3 `product-strategist`
  surface + STOP-FOR-FOUNDER. Pure skill / loop logic — no new foundry events or MCP ops.
  Depends on the conductor (slice 2) and the green-desk generator (slice 4). Closes the loop:
  the conductor no longer idles as long as any greenlit product or repo debt exists.

## 11. Non-goals / YAGNI

- No new foundry concurrency machinery (the store-lock already suffices).
- No new WorkItem fields for ADRs (the aggregate + itemId convention suffice).
- No heavyweight coordinator registry in v1 (the skill invocation is the registration).
- No external OS daemon in v1 (Workflow substrate; daemon is the v2 unattended path).
- No warm worktree pool in v1 (fresh worktree per worker). The pool shipped as the
  slice-2.5 throughput layer (item B, 2026-06-13) — correctness never depends on it.
- The conductor does **not** re-scope items or re-derive disjointness — that is build-path's
  job; the conductor trusts `foundry_next` and the fail-closed `scopesDisjoint` backstop.
