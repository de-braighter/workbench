# Superconductor Tier (Item D / spec Component C′) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/foundry-superconduct` skill — an Agent-loop session that dispatches one **conductor subagent per product/lane**, each dispatching workers, so the founder registers ONE superconductor and it drains the whole foundry across all lanes in parallel (`superconductor → conductors → workers → wave-agents`).

**Architecture:** A declarative skill (the top tier of the foundry orchestration hierarchy), run as an **Agent-loop session** — NOT a Workflow (a Workflow `agent()` node is a leaf and cannot fan out; only the recursive `Agent` tool can express `superconductor → conductors → workers`). The superconductor partitions the claimable frontier into **lanes by product** (cross-product items are disjoint by repo/scope; intra-product disjointness + `dependsOn` is build-path's job), dispatches one `/foundry-conduct`-autonomous **conductor subagent per lane** (reusing the conductor loop, scoped to its product), holds only **per-conductor summaries** (lean context), and aggregates. It is **pure orchestration**: it never claims (workers do), never merges (conductors do), never issues or approves gates (workers request, the founder decides, conductors merge after approval). Collision-safety at any depth comes for free from the single foundry store-lock.

**Tech Stack:** Markdown skill authoring (`.claude/skills/`). Reuses `/foundry-conduct` (autonomous mode), `/foundry-worker`, the foundry MCP (`foundry_status`, `foundry_next`, `foundry_gate_status`), and `product-strategist`. No code.

---

## Why this shape (the load-bearing constraints)

- **Fan-out matrix (verified 2026-06-13):** a regular `Agent`-tool subagent KEEPS the `Agent` tool and can spawn children recursively; a Workflow `agent()` node is a LEAF with no spawn primitive. → the superconductor MUST be an Agent-loop session, and the conductor subagents it spawns are regular `Agent` subagents (so they can spawn workers, who can spawn wave-agents).
- **One foundry store-lock arbitrates every claim** (`ops.ts` — `claim`/`reserveAdr`/`release` all funnel through `withStoreLock`). → the superconductor needs ZERO collision logic at any depth; redundant dispatch is harmless (a lost claim re-fetches).
- **Lanes = products.** `build-path` designs intra-product disjointness + `dependsOn`; cross-product items are disjoint by different repo or distinct scope. → one conductor per `productKey` is a clean, non-overlapping lane (green-desk-`<repo-slug>` products are debt lanes).
- **The inviolable boundaries are enforced at the LEAVES, never relaxed upward:** each conductor enforces "T2 never auto-merges without an item-bound approved `ship` gate (matched by `payloadRef`)" + "new products are never auto-built." The superconductor's Tier-3 (new product) ALWAYS STOP-FOR-FOUNDER. The superconductor reuses `/foundry-conduct` rather than re-deriving the merge rule, so the boundary lives in exactly one place.
- **Filler runs ONCE at the top**, not per-conductor — else N conductors each run `product-strategist`. The superconductor owns the global IDLE→filler escalation.

## File Structure

- **Create** `.claude/skills/foundry-superconduct/SKILL.md` — the superconductor skill (the substance): frontmatter, the Agent-loop rationale, the lane-partition + dispatch loop, the conductor-subagent prompt (delegates to `/foundry-conduct` autonomous, scoped), lean-context + summaries, the global filler, the inviolable-boundary propagation, recovery/stateless-restart, concurrency guards.
- **Modify** `docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` — annotate **Component C′** as implemented (item D); note the conductor-per-lane partition + lean-summary aggregation + filler-at-the-top decisions; mark the C′ tier in the slice/deferred list as shipped.

No file is large; the skill is the only nontrivial artifact, modeled closely on `/foundry-conduct`.

---

## Task 1: Author the `/foundry-superconduct` skill

**Files:**
- Create: `.claude/skills/foundry-superconduct/SKILL.md`

- [ ] **Step 1: Frontmatter + intent**

`name: foundry-superconduct`. A trigger-rich `description` that fires on "superconduct the foundry", "register me as a superconductor", "drain the whole foundry", "fan out conductors across all products", and explains it is the top tier (`superconductor → conductors → workers → wave-agents`), run as an Agent-loop session, registering this session as the superconductor. Tags: `[foundry, superconductor, orchestration, autonomous]`. State the telos: the founder registers ONE superconductor and it drains the whole foundry; lean context at every tier.

- [ ] **Step 2: "Hard rules (inherit + propagate)" section**

Model on `/foundry-conduct`'s hard rules, escalated one tier:
- The superconductor itself NEVER claims, NEVER merges, NEVER requests/approves gates. It only *reads* (`foundry_status`/`foundry_next`/`foundry_gate_status`) and *dispatches conductor subagents*. Every claim/merge/gate-request happens at the conductor/worker leaves.
- One conductor subagent per product/lane. Lean context: the superconductor holds only per-conductor SUMMARIES, never per-item/per-worker detail.
- The inviolable boundaries are enforced at the conductor leaves and NEVER relaxed by the superconductor: a conductor NEVER auto-merges a T2 item without `foundry_gate_status` showing an `approved` gate whose `payloadRef` references THAT item; new products are NEVER auto-built (the superconductor's Tier-3 always STOP-FOR-FOUNDER).
- Multi-superconductor / multi-conductor safe by construction: the foundry store-lock arbitrates every claim at any depth; redundant dispatch is harmless.

- [ ] **Step 3: "Substrate — why Agent-loop, not Workflow" section**

State the fan-out capability matrix (verified 2026-06-13): a regular `Agent`-tool subagent CAN fan out children (recursively); a Workflow `agent()` node is a leaf that CANNOT. Therefore `superconductor → conductors → workers → wave-agents` is expressible ONLY via the recursive `Agent` tool — the superconductor is an Agent-loop **session** (like autonomous-mode `/foundry-conduct`), and the conductor subagents it spawns are regular `Agent` subagents (so they keep the `Agent` tool and can spawn workers). Cite the matrix table (Regular `Agent` subagent = YES; Workflow `agent()` node = NO).

- [ ] **Step 4: "Protocol" + "The loop" section**

1. Mint a superconductor id once: `super-<yyyyMMdd-HHmmss>-<4hex>`.
2. **RECOVERY PASS** (the superconductor holds NO durable state): `foundry_status` → read the board (products, BUILT-awaiting-merge, pending gates). The awaiting-merge set is owned per-lane by each conductor's own RECOVERY PASS — the superconductor does not rebuild it; it re-partitions lanes from the board. Stateless restart is true: a fresh superconductor re-partitions from `foundry_status`.
3. **The loop** (until all lanes idle OR context-critical):
   - **a. POLL:** `foundry_status` + `foundry_next(limit 50)` — lock-free reads.
   - **b. PARTITION into lanes by product:** group the claimable frontier + active products by `productKey`. Each distinct product (including each `green-desk-<repo-slug>` debt product) is a lane. Cross-product items are disjoint by repo/scope; intra-product disjointness + `dependsOn` is build-path's contract — the superconductor trusts it and the fail-closed `scopesDisjoint` backstop.
   - **c. DISPATCH one conductor subagent per lane** (cap = `maxConductors`, default 4; excess lanes wait for the next pass):
     ```
     Agent({
       subagent_type: <general-purpose>,
       model: <pinned>,                 // pin — inheritance death orphans a lane
       prompt: <conductorPrompt(productKey)>   // see Step 5
     })
     ```
     Conductors run CONCURRENTLY. Each returns a lane summary.
   - **d. COLLECT summaries** (barrier or rolling): the superconductor holds ONLY `{ productKey, built, merged, awaitingGate, idle, stopReason }` per conductor — never per-item detail. This is the lean-context guarantee.
   - **e. AGGREGATE + re-poll:** newly-unblocked items (deps released `done`) and new lanes (a Tier-1 filler emitted a new product's items) surface on the next `foundry_status`. Re-partition + re-dispatch; stop a lane that reported idle with nothing new.
   - **f. GLOBAL IDLE → filler (ONCE at the top, never per-conductor):** when ALL lanes report idle (no claimable, no awaiting-merge), invoke the pipeline-filler ladder ONCE: Tier 1 (`/build-path` continuation per greenlit product — greenlit predicate via `foundry_gate_status`), Tier 2 (`/green-desk --all`), Tier 3 (`product-strategist` → SURFACE proposals → **STOP-FOR-FOUNDER**, never auto-build). True idle = all three tiers dry.
   - **g. CONTEXT CHECK:** near context-critical → STOP; report all lane summaries + every pending gate (lane, itemId, gate type, prRef). A fresh superconductor re-partitions from `foundry_status` and continues — no handoff.

- [ ] **Step 5: "The conductor-subagent prompt" section**

Give the exact prompt string the superconductor passes to each conductor subagent. It must:
- Tell the conductor it is a foundry conductor in AUTONOMOUS mode, **SCOPED to product `<productKey>`**: follow the workbench `/foundry-conduct` skill's autonomous-mode loop, but only dispatch workers for items in `<productKey>`, only merge `<productKey>`'s PRs, only read `<productKey>`'s gates (`foundry_gate_status { productKey }`).
- Reuse `/foundry-conduct` (do NOT re-derive the merge rule): the conductor enforces the inviolable merge rule (T2 never merges without an item-bound approved `ship` gate matched by `payloadRef`; T0/T1 merge on a green wave) and never auto-builds a new product.
- Dispatch worker subagents via the `Agent` tool (the conductor keeps the `Agent` tool — fan-out matrix); each worker runs the `/foundry-worker` protocol + its own verifier wave and returns a summary.
- Pin model; set `NX_DAEMON=false`; FORBID any git op in the shared root clone; use one `FOUNDRY_DATA_DIR`; treat a store-lock timeout as transient.
- RETURN a structured lane summary: `{ productKey, built: [itemId…], merged: [itemId…], awaitingGate: [{itemId, gate, prRef}…], idle: bool, stopReason }`.

- [ ] **Step 6: "Lean context", "Multi-superconductor safety", "Concurrency guards", "Deferred" sections**

- **Lean context at every tier:** superconductor holds per-conductor summaries; each conductor holds per-worker summaries; each worker holds its own build. The founder registers ONE superconductor; it drains the whole foundry without ever holding the leaf detail.
- **Multi-superconductor safety:** several superconductors are safe (store-lock arbitrates every claim) but wasteful; v1 assumes one superconductor (the founder registers one). Same arbitration that makes multi-coordinator safe makes multi-conductor safe — zero extra machinery.
- **Concurrency guards (propagate to every tier):** unique worktree per claim + forbid git ops in the shared root clone · `NX_DAEMON=false` · heartbeat under TTL · pin `model:` at every dispatch · orphan cleanup on release · one `FOUNDRY_DATA_DIR` · store-lock-timeout = transient backoff, never delete `.lock`.
- **Deferred (named):** a lightweight `ConductorRegistered`/`SuperconductorRegistered` presence record for `foundry_status` observability; an external OS daemon for 24/7 cross-session running (v2). The warm worktree pool (§C.4, item B) composes orthogonally — conductors lease pool slots for their workers once it lands.

- [ ] **Step 7: Coherence self-check + commit**

Re-read against `/foundry-conduct` (the tier it sits above): does the conductor-subagent prompt faithfully delegate to autonomous mode? Are the inviolable boundaries enforced at the leaf and never at the superconductor? Is the filler at the top (once), not per-conductor? Fix inline.

```bash
git add .claude/skills/foundry-superconduct/SKILL.md
git commit -m "feat(foundry-superconduct): superconductor tier — Agent-loop conductors-per-lane (Component C')"
```

---

## Task 2: Annotate Component C′ as implemented in the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md`

- [ ] **Step 1: Add the "Implemented" note under "Component C′"**

A short note: shipped as `.claude/skills/foundry-superconduct/SKILL.md` (item D). Resolved decisions: lanes partitioned **by product** (one conductor subagent per `productKey`); the superconductor holds only per-conductor **summaries** (lean context); the pipeline-filler runs **once at the top** (not per-conductor) so `product-strategist` runs once; the inviolable boundaries are enforced at the conductor leaves and never relaxed by the superconductor; multi-superconductor safety is free from the one store-lock. Note it is an **Agent-loop session** (the fan-out matrix forbids a Workflow).

- [ ] **Step 2: Mark the C′ tier shipped in the slice/deferred list**

Where the design lists C′ / the superconductor as a v2/deferred tier, annotate it implemented (item D, 2026-06-13). Keep the warm worktree pool (§C.4, item B) as the remaining deferred item.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md
git commit -m "docs(spec): mark Component C' (superconductor) implemented (item D)"
```

---

## Task 3: Open the PR, run the verifier wave, land it

- [ ] **Step 1: Push + open the PR** on `de-braighter/workbench`, body carrying `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effort: standard`, `Effect: cycle-time 0.01±0.02 expert` + `Effect: findings`, and a `Refs:` to the design spec Component C′. Open BEFORE the wave.

- [ ] **Step 2: Verifier wave** — `reviewer` + `qa-engineer` + `charter-checker` + `local-ci` in parallel, all `isolation: 'worktree'`, read-only on the pushed diff. The wave checks: the Agent-loop rationale is correct (workers must self-wave → conductors must keep the `Agent` tool); the inviolable boundaries are enforced at the leaves and NOT weakened anywhere; the superconductor never claims/merges/gates; lanes are genuinely disjoint (by product); the filler runs once at the top; the conductor-subagent prompt faithfully delegates to `/foundry-conduct` autonomous (no merge-rule drift); stateless restart holds.

- [ ] **Step 3: Post findings BEFORE any fix** — write to a temp JSON `[{verifier, severity, path?, line?, text}]` (severity ∈ `blocking|should-fix|nit|note`; omit `path` for PR-level notes) and run `npm run dev -- post-findings de-braighter/workbench#<pr> findings.json` from `domains/devloop`.

- [ ] **Step 4: Fix blocking/critical findings; re-review the blockers.**

- [ ] **Step 5: Admin-merge (freeze-merge):** `gh pr merge <pr> --repo de-braighter/workbench --squash --admin`. **Gate cleanup on VERIFIED-merged:** `gh pr view <pr> --json state` must equal `MERGED` before any worktree teardown.

- [ ] **Step 6: Twin ritual** — `drain` (after wave) → after merge `backfill` → `reconcile` → `ritual:post-merge`.

- [ ] **Step 7: Worktree cleanup (after verified-merged only)** — `git worktree remove` + `git branch -D` from the cluster root.

---

## Self-Review (run before execution)

- **Spec coverage:** Component C′ → Task 1 (the skill) + Task 2 (spec annotation). The C′ table (fan-out matrix), the `N×M` parallelism, lean-context-at-every-tier, collision-safe-at-any-depth → Task 1 steps 2–6. ✓
- **Placeholder scan:** every step names exact files + exact content; the conductor-subagent prompt requirements are enumerated (Step 5). ✓
- **Type/name consistency:** `foundry-superconduct` skill name, `super-<…>` id, the lane-summary shape `{ productKey, built, merged, awaitingGate, idle, stopReason }` are consistent across Steps 4/5/6. ✓
- **Scope:** one workbench PR, one new skill + one spec edit — single plan, no decomposition. ✓
