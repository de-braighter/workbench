---
name: foundry-worker
description: "Foundry worker-session boot protocol — atomically claim ONE work item, isolate in a git worktree, execute via existing skills, pass tier-gated quality, land the PR with the twin ritual, release the claim. Use when a pasted session prompt names a foundry work item, when asked to work an item from the foundry queue, or in POOL MODE (via the foundry-pool skill) where the session self-serves the top pool-eligible claimable item."
tags: [foundry, session-protocol, autonomous]
---

# Foundry Worker Session

One session works EXACTLY one claimed item under the session protocol
(spec §5/§7: `docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md`),
then stops. The Foundry adds no new way to build — this skill routes to the
existing arsenal and adds only collision safety + tier-gated quality.

## Hard rules (fail closed)

- **Never work a queue item unclaimed.** `foundry_*` tools unavailable or store
  errors → stop (read-only diagnosis at most). A claim rejection is
  mode-dependent — item mode stops, pool mode takes the bounded Phase-1 retry —
  but in EVERY mode no write happens without an accepted claim. A pasted
  session prompt holds no lock; only `foundry_claim` does.
- **Never edit in the shared clone.** Every write happens in the claim's worktree.
- **Never bypass quality gates.** Floor can't go green → release `blocked`.
- **Scope is a hard boundary.** Touch nothing outside the item's scope. Same-repo
  disjointness is proven by non-nested pathPrefixes or distinct issues (the
  server's rules); pathPrefix is the boundary you can CHECK against the diff.
- **One item per session.** Release, report, stop. Pool capacity comes from the
  founder launching more sessions, never from in-session looping — fresh context
  per item is a quality feature, not an inefficiency.

## Phase 0 — BOOT

1. Mint a session id once and reuse it for every foundry call:
   `sess-<yyyyMMdd-HHmmss>-<4 hex>` (e.g. `sess-20260610-143012-a3f9`).
2. Identify the item — two launch modes:
   - **Item mode** — the launch prompt names an itemId: work THAT item; do NOT
     pick a different one unless the founder said so.
   - **Pool mode** — launched via the `foundry-pool` skill, or asked to "work
     the next foundry item" with no itemId: `foundry_next` (**limit 50** — the
     wide window is load-bearing: the queue sorts priority-ascending, so a run
     of high-priority items must not hide claimable items further down; "nothing
     claimable" may only be concluded after seeing the full list) and take the
     TOP **pool-eligible** item. Candidates are re-fetched on each Phase-1
     retry — the extras are context, not alternatives to browse by preference.
     **Pool eligibility:** skip candidates whose dependencies are not yet `done`
     (the server enforces this anyway, but skip eagerly to avoid wasted claim
     attempts). T2 items are eligible — T2 control is at the gates, not the
     launch (the conductor + `foundry_reserve_adr` ADR-number coordination make
     parallel T2 build work collision-safe). Queue empty or all candidates
     structurally blocked → report `foundry_status` and stop.
3. Derive, before claiming:
   - **slug** — itemId lowercased, every non-`[a-z0-9]` run → `-`
     (`agri/E1.1` → `agri-e1-1`)
   - **branch** — `feat/<slug>`
   - **repo local path** — scope repo `de-braighter/<name>` →
     `domains/<name>/` or `layers/<name>/` (whichever exists under the cluster
     root); `de-braighter/workbench` → the cluster root itself
   - **worktree** — `<repo-local-path>/.claude/worktrees/<slug>`
4. Optional sanity: `foundry_status` (board view; stale claims list abandoned worktrees).
5. Product context (mandatory before EXECUTE): check the memory index for the
   product's arc file (the "Read before <domain> work" line) and read it — it
   carries the repo's live gotchas (API drift, path traps, install quirks).
   Sibling ACTIVE claims on the same product are EXPECTED under parallel lanes:
   never reclaim them, never touch their scope or worktrees, never "clean up"
   their branches.

## Phase 1 — CLAIM (before any write)

```text
foundry_claim { itemId, sessionId, worktree: <planned path>, branch: <planned branch> }
```

- On acceptance, keep the returned `claimId` and proceed to Phase 2.
  **When the claim is REJECTED** (a readable `ERROR:` naming the conflict —
  `unknown item` / `item already done` / `dependencies not done` / `item
  already claimed` / `scope overlap` — never a transport failure): item mode
  stops and reports; pool mode takes the bounded ≤3-attempt re-fetch retry.
  Full rejection handling per launch mode → read `references/recovery.md`.
- Keep the returned `claimId`. Heartbeat discipline from here on:
  `foundry_heartbeat { claimId }` at every phase boundary and at least every
  2 hours (TTL 240 min). A heartbeat **error** means the claim was superseded —
  stop working immediately.

## Phase 2 — ISOLATE

From the cluster root:

```bash
cd <repo-local-path>
git fetch origin main
# local-only exclude if the repo doesn't ignore worktrees (no PR pollution); idempotent:
grep -q '\.claude/worktrees/' .gitignore .git/info/exclude 2>/dev/null || echo '.claude/worktrees/' >> .git/info/exclude
git worktree add .claude/worktrees/<slug> -b feat/<slug> origin/main
cd .claude/worktrees/<slug>
npm install   # or pnpm install — lockfile decides; a fresh worktree starts without node_modules
```

**Warm pool (throughput; correctness never depends on it; AUTO-ENGAGED via self-lease).**
Instead of the cold `git worktree add` above, self-lease a warm slot that preserves
`node_modules` (`foundry_lease_slot { claimId }` → reset-on-lease). It is a throughput layer,
NEVER a correctness dependency — any lease failure falls back to the cold recipe above. Full
self-lease recipe → read `references/warm-pool.md`.

- **Worktree/branch already exists at the slug, or creation fails** (usually an
  expired claim, but slugs CAN collide across itemIds — never assume): handle per
  `references/recovery.md` (check `foundry_status` first; release `blocked` on a
  live-work collision, else clean the leftover and retry).
- Nx-repo gotcha: a worktree's nx daemon can lock the main clone's nx db —
  set `NX_DAEMON=false` in the worktree if builds wedge.

## Phase 3 — EXECUTE

Route by situation — never invent a new build style:

| Situation | Route |
| --- | --- |
| Implementation plan exists for the item | superpowers:subagent-driven-development |
| No plan, non-trivial | superpowers:brainstorming → superpowers:writing-plans → subagent-driven-development |
| Trivial, well-scoped fix | superpowers:test-driven-development directly |
| Risky change (new ports, kernel primitives, cross-cutting) or **any T2 item** | designer-first (`workflows/designer-first.md`) FIRST — mandatory at T2 |
| Green-desk cleanup item (`green-desk-<repo-slug>/debt-<area>-<sha7>`) | fix the offenses the title names DIRECTLY under the quality floor, diff confined to the area `pathPrefix`; detail (`/tech-debt` reuse limits, scope confinement) → `references/green-desk-items.md` |

**Reserved ADR numbers:** if the claimed item's `itemId` is `<key>/ADR-<n>`,
the number is already in the itemId — consume it directly; do NOT read or
allocate from `next-free-adr`. The designer-first step uses **that exact number**
for the ADR file and PR title. The PR title is generated from the itemId
(`ADR-<n> … (<productKey> <itemId>)`), which is what prevents item-attribution
drift (the O-4→"O-2" mislabel cannot recur when the title comes from the itemId,
not from the worker's freehand choice). (A `foundry_status`/read surface for the
reservation aggregate is a slice-3 follow-up.)

- Honor the item's `qualityObligations` (they parameterize the floor, e.g. `mutation>=60`).
- **Scope overlap discovered mid-build, or the build dead-ends** (infeasible item,
  unresolvable dependency, repeated unrelated failures) → handle per
  `references/recovery.md` (overlap: older claim proceeds, you `foundry_handoff`
  + stop; dead-end: `foundry_release{blocked}` + why — never sit on a claim).

## Phase 4 — QUALITY (tier-gated; PR opens BEFORE the wave)

1. Repo gate green in the worktree: `npm run ci:local` (or `pnpm run ci:local`
   — lockfile decides).
2. Scope confinement: `git diff --name-only origin/main...HEAD` — every path
   inside the scope `pathPrefix` (when set). Out-of-scope file → revert it or handoff.
3. Push the branch, open the PR (template: `templates/pr/template.md`) — the PR
   must exist before the wave so findings are postable. Body carries
   (per `policies/git.md`):
   - `Producer: foundry-worker/<model> [skill1, skill2]`
   - `Effort: light|standard|deep` — declare what the PR ACTUALLY got (anchored:
     light = no wave; standard = wave; deep = wave + designer-first and/or
     ≥2 review rounds), never aspirationally
   - `Effect:` only when defensible — prefer `cycle-time` / `findings`
     (same-session merge cycle-time ≈ 0.005–0.01 h).
4. Verifier wave per tier — **foreground, never `run_in_background`** (background
   agents lose verdict capture). Before composing the wave, consult the twin's
   advisory: `npm run dev -- wave <owner>/<repo>` from `domains/devloop`
   (per `workflows/verifier-wave.md` §Consult the twin) — advisory only;
   thin data falls back to the standard wave:
   - **T0** — standard wave (`workflows/verifier-wave.md`).
   - **T1** — wave + Sonar gate (`npm run ci:sonar` / `sonar:scan` where wired);
     kernel-touching items get the deep treatment (designer-first and/or ≥2
     review rounds) — then declare `Effort: deep`.
   - **T2** — full battery + RLS/tenancy proofs where touched + designer-first
     evidence linked in the PR.
5. Findings ritual BEFORE any fix commit: write the wave's findings to a temp
   JSON and run `npm run dev -- post-findings <owner>/<repo>#<pr> findings.json`
   from `domains/devloop` (full `owner/repo#pr` — short form 404s). Then fix.
6. Floor stays red after honest attempts → `foundry_release { claimId,
   outcome: "blocked", note: <failure> }` — the item re-queues with the failure
   attached. Never bypass, never `--no-verify`.

## Phase 5 — LAND

1. Merge per tier: **T0** green wave → squash-merge. **T1** green wave + Sonar →
   squash-merge. **T2** → `foundry_gate_request { productKey, gateType: "ship",
   payloadRef: <pr url> }` and WAIT for the founder — never auto-merge (still
   pending at session end → `foundry_release { claimId, outcome: "blocked",
   note: "gate <gateId> pending" }`).
2. Twin ritual (mandatory, from `domains/devloop`): after the wave
   `npm run dev -- drain <repo#pr>` (short form OK for drain); after merge
   `npm run dev -- backfill <owner>/<repo>` (full form, like `post-findings`)
   then `npm run dev -- reconcile`;
   `npm run ritual:post-merge` covers reviews + resolve-findings.
3. Cleanup from the repo root — **only if you cold-added**: `git worktree remove
   .claude/worktrees/<slug>` (it should be clean after a merge — investigate
   before reaching for `--force`), delete the merged branch. **If you leased a
   warm slot (`.claude/wt-pool/slot-N`), leave it in place** — the pool reuses it
   and the next lease resets it to a pristine tree; do NOT remove it.

## Phase 6 — RELEASE

```text
foundry_release { claimId, outcome: "done", prRef: "<owner>/<repo>#<pr>" }
```

Then STOP. Final report: item, PR, wave verdicts, ritual confirmations, claim released.

## Failure stances quickref (spec §7)

When ANY phase deviates from the happy path — MCP unavailable, claim rejected,
worktree creation fails, scope overlap mid-build, quality floor red, build
dead-end, heartbeat error (claim superseded), or a founder gate still pending at
session end — read **`references/recovery.md`** for the full per-situation stance
table. The invariant under all of them: never work unclaimed, never bypass a
gate, and never hold a claim you can't progress (`foundry_release{blocked}` with
the reason re-queues the item).
