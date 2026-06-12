---
name: foundry-worker
description: "Foundry worker-session boot protocol — atomically claim ONE work item, isolate in a git worktree, execute via existing skills, pass tier-gated quality, land the PR with the twin ritual, release the claim. Use when a pasted session prompt names a foundry work item, when asked to work an item from the foundry queue, or in POOL MODE (via the foundry-pool skill) where the session self-serves the top claimable item."
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
     the next foundry item" with no itemId: `foundry_next` (limit 3) and take
     the TOP **pool-eligible** item. Candidates are re-fetched on each Phase-1
     retry — the extras are context, not alternatives to browse by preference.
     **Pool eligibility:** skip any candidate whose `riskTier` is **T2** (T2 is
     founder-launch-only by default — `foundry_next` returns `riskTier` per
     item) and any candidate whose `qualityObligations` include
     `founder-launch-only`. Skipped-as-ineligible does NOT consume a claim
     attempt. All claimable items ineligible → report them
     ("awaiting founder-launched sessions") and stop.
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

- A rejection comes back as a readable `ERROR:` result naming the precise
  conflict (`unknown item` / `item already done` / `dependencies not done:
  <ids>` / `item already claimed by session <sid>` / `scope overlap with active
  claim on <item>`) — never a transport failure. What to do depends on launch mode:
  - **Item mode** → report the conflict and **STOP**. The prompt's item is taken
    or not ready; never substitute another.
  - **Pool mode** → an `already claimed` / `scope overlap` rejection is an
    EXPECTED race with a sibling pool worker, not a failure: re-run
    `foundry_next` (the lost item drops off the claimable list) and claim the
    new TOP item. At most **3 claim attempts** per session; all rejected or the
    list comes back empty → report the board (`foundry_status`) and stop
    cleanly. An idle pool worker never waits or polls for work. Only
    `already claimed` / `scope overlap` are expected races: a `dependencies not
    done` / `unknown item` / `item already done` rejection in pool mode is NOT
    a race (`foundry_next` never surfaces such items) — it signals a stale or
    corrupt queue view; report and stop.
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

- A leftover worktree/branch at the slug is usually from an EXPIRED claim — but
  distinct itemIds CAN collide on one slug, so never assume. Check
  `foundry_status` first: any OTHER session's active claim referencing that
  worktree path means slug collision with live work — do not touch it;
  `foundry_release { claimId, outcome: "blocked", note: "slug collision with
  <other item>" }` and stop (the item re-queues). Only when no other active
  claim references it, remove the leftover (`git worktree remove --force`,
  `git branch -D`) and retry. Creation still fails →
  `foundry_release { claimId, outcome: "blocked", note }` and stop.
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

- Honor the item's `qualityObligations` (they parameterize the floor, e.g. `mutation>=60`).
- Discover you must touch files outside the scope → spec §7 stance: the OLDER
  claim proceeds; YOU hand back — `foundry_handoff { claimId, note: <what overlaps> }`,
  then stop. The build-path lane map gets corrected upstream.
- The build dead-ends (infeasible item, unresolvable dependency, repeated
  failures unrelated to your changes) → `foundry_release { claimId,
  outcome: "blocked", note: <why> }` and stop — never sit on a claim; the item
  re-queues with the reason attached.

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
3. Cleanup from the repo root: `git worktree remove .claude/worktrees/<slug>`
   (it should be clean after a merge — investigate before reaching for
   `--force`), delete the merged branch.

## Phase 6 — RELEASE

```text
foundry_release { claimId, outcome: "done", prRef: "<owner>/<repo>#<pr>" }
```

Then STOP. Final report: item, PR, wave verdicts, ritual confirmations, claim released.

## Failure stances quickref (spec §7)

| Situation | Action |
| --- | --- |
| Foundry MCP unavailable / store corrupt | No claim → no work. Stop, report. |
| Claim rejected | Item mode: stop, report which conflict. Pool mode: re-fetch `foundry_next`, claim the new top (≤3 attempts total), then stop. |
| Worktree creation fails | `foundry_release(blocked)` + note. |
| Scope overlap discovered mid-build | Older claim proceeds; newer `foundry_handoff` + stop. |
| Quality floor red | `foundry_release(blocked)` with the failure attached. |
| Build dead-ends mid-EXECUTE (infeasible / unresolvable) | `foundry_release(blocked)` + why — never hold the claim until TTL. |
| Heartbeat errors (claim superseded) | Stop working immediately; report. |
| Founder gate still pending at session end | `foundry_release(blocked)` + note the gateId — the item re-queues; a later session merges after approval. Gates never block other products' lanes. |
