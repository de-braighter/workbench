---
name: foundry-pool
description: "Foundry pool-worker boot — start a generic worker session that SELF-SERVES the top claimable item from the foundry queue (no item named by the founder), then follows the full foundry-worker protocol: atomic claim with bounded retry, worktree isolation, tier-gated quality, twin ritual, release, stop. Use when the founder says '/foundry-pool', 'join the pool', 'work the next foundry item', or starts a session with no specific work item."
tags: [foundry, session-protocol, autonomous, pool]
---

# Foundry Pool Worker

One generic session = one work item, chosen by the QUEUE, not the founder.
This skill is a thin boot shim: everything substantive lives in the
`foundry-worker` skill (the canonical session protocol) — **invoke it now**
(Skill tool) and follow it end to end in **pool mode**. The rest of this page
is a summary so a session can sanity-check its own behavior; where they ever
disagree, `foundry-worker` (Skill tool, name: `foundry-worker`) wins.

## Boot sequence (summary of foundry-worker pool mode)

1. Invoke the `foundry-worker` skill. Phase 0 in pool mode: mint a session id,
   `foundry_next` (limit 3), take the TOP item, derive slug/branch/worktree.
2. Phase 1: `foundry_claim` — a rejection (`already claimed` / `scope overlap`)
   is an EXPECTED race with a sibling pool worker, not a failure: re-fetch
   `foundry_next` (the lost item drops off the claimable list) and claim the
   new top. At most 3 claim attempts per session; all rejected or the list
   comes back empty → report `foundry_status` and stop cleanly. Any OTHER
   rejection (`dependencies not done` / `unknown item` / `item already done`)
   is not a race — report and stop. Never work unclaimed; never wait or poll
   for work.
3. Once the claim settles, read the claimed product's arc memory
   (foundry-worker Phase 0 step 5 — mandatory before EXECUTE; the claimed
   product can change across retries, so read AFTER the claim). Then Phases
   2–6 exactly per `foundry-worker`: isolate in the claimed worktree →
   execute via existing skills → tier-gated quality (consult the twin's
   advisory `npm run dev -- wave <owner>/<repo>` from `domains/devloop` when
   composing the verifier wave) → land with the twin ritual → release → STOP.

## Pool invariants

- **One item per session.** Pool capacity = number of sessions the founder
  launches, never in-session looping — fresh context per item is a quality
  feature.
- **Queue empty / nothing claimable** → report the board and stop. An idle
  pool worker never polls.
- **Sibling claims are expected.** Parallel lanes are the design, not a
  conflict: never reclaim, touch, or clean up another session's scope,
  worktree, or branch.
- **Founder gates still gate.** T1/T2 stops are unchanged from
  `foundry-worker`; pool mode changes WHO picks the item, never what may ship.
