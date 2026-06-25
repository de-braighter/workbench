# Recovery, rejections, and failure stances (foundry-worker)

> Load this when a foundry call is **rejected**, a worktree/slug **collides or fails to
> create**, you discover a **scope overlap mid-build**, the **quality floor stays red**, a
> **heartbeat errors**, or a **founder gate is still pending at session end**. The core
> SKILL.md happy-path assumes the claim is accepted, the worktree is clean, the diff stays
> in scope, and the floor goes green; everything that deviates is handled here.

## Phase 1 — CLAIM rejection handling

A rejection comes back as a readable `ERROR:` result naming the precise
conflict (`unknown item` / `item already done` / `dependencies not done:
<ids>` / `item already claimed by session <sid>` / `scope overlap with active
claim on <item>`) — never a transport failure. What to do depends on launch mode:

- **Item mode** → report the conflict and **STOP**. The prompt's item is taken
  or not ready; never substitute another.
- **Pool mode** → an `already claimed` / `scope overlap` rejection is an
  EXPECTED race with a sibling pool worker, not a failure: re-run
  `foundry_next` (the lost item drops off the claimable list) and claim the
  new TOP **pool-eligible** item (the Phase-0 eligibility skip applies on
  EVERY fetch). At most **3 claim attempts** per session; all rejected or the
  list comes back empty → report the board (`foundry_status`) and stop
  cleanly. An idle pool worker never waits or polls for work. Only
  `already claimed` / `scope overlap` are expected races: a `dependencies not
  done` / `unknown item` / `item already done` rejection in pool mode is NOT
  a race (`foundry_next` never surfaces such items) — it signals a stale or
  corrupt queue view; report and stop.

## Phase 2 — ISOLATE: leftover worktree / slug collision

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

## Phase 3 — EXECUTE: scope overlap and dead-ends

- Discover you must touch files outside the scope → spec §7 stance: the OLDER
  claim proceeds; YOU hand back — `foundry_handoff { claimId, note: <what overlaps> }`,
  then stop. The build-path lane map gets corrected upstream.
- The build dead-ends (infeasible item, unresolvable dependency, repeated
  failures unrelated to your changes) → `foundry_release { claimId,
  outcome: "blocked", note: <why> }` and stop — never sit on a claim; the item
  re-queues with the reason attached.

## Phase 4 — QUALITY: floor stays red

Floor stays red after honest attempts → `foundry_release { claimId,
outcome: "blocked", note: <failure> }` — the item re-queues with the failure
attached. Never bypass, never `--no-verify`.

## Failure stances quickref (spec §7)

| Situation | Action |
| --- | --- |
| Foundry MCP unavailable / store corrupt | No claim → no work. Stop, report. |
| Claim rejected | Item mode: stop, report which conflict. Pool mode: re-fetch `foundry_next`, claim the new pool-eligible top (≤3 attempts total); queue empty or all structurally blocked → report `foundry_status` + stop. |
| Worktree creation fails | `foundry_release(blocked)` + note. |
| Scope overlap discovered mid-build | Older claim proceeds; newer `foundry_handoff` + stop. |
| Quality floor red | `foundry_release(blocked)` with the failure attached. |
| Build dead-ends mid-EXECUTE (infeasible / unresolvable) | `foundry_release(blocked)` + why — never hold the claim until TTL. |
| Heartbeat errors (claim superseded) | Stop working immediately; report. |
| Founder gate still pending at session end | `foundry_release(blocked)` + note the gateId — the item re-queues; a later session merges after approval. Gates never block other products' lanes. |
