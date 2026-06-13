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
MCP tools; the only new foundry code is one allocator op. The conductor has **two work
sources**: `/build-path` (products, from a masterplan) and the periodic **green-desk sweep**
(Component D — drive every repo's debt to zero on a cadence).

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

## Component C′ — The superconductor tier (fan-out capability matrix)

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
+ `Agent`-loop conductor is a v2 tier when scale-out across many products is the bottleneck.

## Component D — Periodic green-desk sweep (maintenance workstream)

A *second work source* for the conductor, alongside `/build-path`: a **periodic sweep that
drives every repo to a "fully green desk"** — zero outstanding debt on every dimension, with
test coverage the sole "higher-is-better" exception. (Founder-requested, 2026-06-13.)

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
(`<repo>/debt-<area>`) to the foundry queue — pathPrefix'd by area so the conductor
parallelizes them. Each item names its dimension(s) + offending locations.

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

## 7. The autonomy boundary (the founder's control surface)

**Dropped — "T2 = founder-launch-only."** Pool/conductor workers may now self-serve T2
items. This deletes the gnarliest open question ("how does a conductor get per-item T2
launch authorization") — authorization moves entirely to the gates. Skill edits:
`foundry-worker/SKILL.md` Phase 0 eligibility + `foundry-pool/SKILL.md` invariants remove
the T2/`founder-launch-only` skip.

**Kept, inviolable — the four founder gates.** They are the *real* governance, and dropping
launch-only makes them load-bearing:
- **T0/T1** auto-merge on a green wave (+ Sonar for T1).
- **T2** builds to its `ship` gate, releases **`blocked-pending-gate`, and NEVER
  auto-merges.** Designer-first + every kernel-touching `adr` gate remain mandatory.
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
| D1 | Conductor substrate | **Workflow tool** (`/foundry-conduct`) | Native fan-out + lean context, deterministic, journaled + resumable, store-lock-safe. v2 = external daemon for 24/7 unattended. *(founder-approved)* |
| D2 | ADR binding location | **`AdrReservation` aggregate** | Queryable allocator state; WorkItem schema stays ADR-176-minimal. |
| D3 | Reservation timing | **Decompose-time, standalone `reserveAdr` op under the shared store-lock** | Atomicity comes from the shared mkdir-mutex (not co-location with `queuePush`); cleaner/composable, `/build-path` calls it per ADR-needing item. Number stays stable across re-claim/handoff. |
| D4 | ADR repo | **specs repo (`layers/specs/adr/`)** for kernel/cross-cutting ADRs | Current practice; ADR item spans two repos vs code items → trivially disjoint by repo. |
| D5 | Gate autonomy | **Gates stay; T2 never auto-merges; launch-only dropped** | §7. *(founder-confirmed)* |
| D6 | Per-item TTL | **Conductor sizes a finite, build-appropriate TTL + heartbeats** | Long enough to exceed the build, finite so a dead worker frees the item. |

## 9. Open questions (resolve during build; none block slice 1)

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
7. **Green-desk FP-suppression ledger + stop condition** (§D) — where reviewed false-positive
   suppressions live (per-tool ignore + a justification ledger so they're auditable, not
   silent) and the loop's no-new-progress stop so it never chases unfixable noise.
8. **Green-desk cadence/scope + mutation target** (§D.5/D.1) — the cadence, which repos are
   in scope, and whether mutation gets a hard target (prefer X%) or stays at the tier floor
   like today.

## 10. Build slices (one spec → three slices)

- **Slice 1 — ADR-coordination + ADR-as-item (Components A + B).** Foundry: `AdrReserved`
  event/op/aggregate + `adrAggregateId`. build-path: reserve numbers + emit ADR-authoring
  items + dependsOn edges + rewritten step 5/8. foundry-worker: consume reserved number.
  *The prerequisite that makes parallel T2 safe.* Foundry change = a PR on `domains/foundry`
  (verifier wave); skill changes = workbench declarative edits.
- **Slice 2 — The conductor (Component C) + drop T2-launch-only.** `/foundry-conduct` skill +
  the Workflow script (fresh worktree per worker); concurrency guards; skill eligibility
  edits.
- **Slice 2.5 — Warm worktree pool (§C.4).** Per-repo warm pool with bulletproof
  reset-on-lease. Throughput layer; build once the conductor v1 proves out. (Promote into
  slice 2 if cold-install pain materially hurts first-draft usability.)
- **Slice 3 (later) — refinements.** Orphan-reconcile op, gate-aware board reporting,
  coordinator-presence record, per-item TTL policy, multi-coordinator pool-lease.
- **Slice 4 — Periodic green-desk sweep (Component D).** Debt-path generator (per-repo
  multi-dimension scan → disjoint cleanup items) + the green-desk target check + `/tech-debt`
  routing + loop-until-green + the FP-suppression ledger + the periodic trigger. Depends on
  the conductor (slice 2); reuses the devloop twin + Sonar + the F5 quality floor.

## 11. Non-goals / YAGNI

- No new foundry concurrency machinery (the store-lock already suffices).
- No new WorkItem fields for ADRs (the aggregate + itemId convention suffice).
- No heavyweight coordinator registry in v1 (the skill invocation is the registration).
- No external OS daemon in v1 (Workflow substrate; daemon is the v2 unattended path).
- No warm worktree pool in v1 (fresh worktree per worker; pool is the slice-2.5 throughput
  layer — correctness never depends on it).
- The conductor does **not** re-scope items or re-derive disjointness — that is build-path's
  job; the conductor trusts `foundry_next` and the fail-closed `scopesDisjoint` backstop.
