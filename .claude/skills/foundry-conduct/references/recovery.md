# Conductor recovery — RECOVERY PASS + stateless restart (foundry-conduct)

> Load this on **conductor startup / fresh-conductor launch** (to rebuild the
> awaiting-merge set from durable sources), and when handling **orphaned commits on stale
> claims** or reasoning about **context-critical stop + stateless restart**. The core
> SKILL.md loop step (a) POLL assumes the awaiting-merge set already exists; this is how it
> is reconstructed and why a fresh conductor resumes seamlessly.

## RECOVERY PASS — rebuild the awaiting-merge set from durable sources

Run this ON STARTUP and on every fresh conductor launch, AFTER REGISTER PRESENCE
(`foundry_register_coordinator { kind: 'conductor', sessionId }` → keep the returned
`coordinatorId`; heartbeat `foundry_coordinator_heartbeat { coordinatorId }` once per loop
iteration — presence is observability-ONLY, never a correctness input).

```
RECOVERY PASS — rebuild the awaiting-merge set from durable sources:
  PRIMARY: call foundry_status → read the 'BUILT (awaiting merge)' section.
    Each listed item carries { itemId, prRef } natively — no reconstruction needed.
    For each: add { itemId, prRef, waveVerdict: 'unknown'|<prior>, gate: 'ship'|'none' }
    to the awaiting-merge set. A built item is NEVER re-built.
  BACKSTOP (defense-in-depth): gh pr list --state open for each active repo
    → match open PRs on feat/<slug> branches (slug encodes the itemId)
    → for each matched PR NOT already in the set (e.g. a PR opened before the
       built-release landed): add { itemId, prRef, waveVerdict: 'unknown', gate } to set.
  ORPHAN ADOPTION (stranded commit on a STALE claim — design §9.3): if foundry_status's
    STALE CLAIMS section lists an item that ALSO has an open feat/<slug> PR (a worker that
    pushed its PR then died before releasing 'built', §9 open-question 3 / orphan-reconcile),
    call foundry_reconcile_claim { itemId, prRef } (prRef from the open gh PR — the STALE
    CLAIMS board does not print it) — it releases the stale claim as 'built' (adopting the
    stranded PR), so the item moves to BUILT and the MERGE PASS picks it up.
    (reconcileClaim refuses if the last claim is still ACTIVE — never adopts over a live
    worker; it acts only on a stale, unended claim.) Add it to the awaiting-merge set IF NOT
    ALREADY PRESENT (the BACKSTOP may have matched the same PR) with waveVerdict: 'unknown'.
    A reconciled orphan enters 'unknown' and MUST be RE-WAVED (run the verifier wave on its
    PR, set waveVerdict from it) before the MERGE PASS can pass it — a never-waved orphan is
    never merged.
  This is the only pass that writes the awaiting-merge cache on startup.
  Stateless restart is TRUE: the awaiting-merge set (keyed by itemId) is rebuilt from the
  foundry log's built items (exact), with gh open PRs as backstop (defense-in-depth).
```

## Context-critical stop and stateless restart (TRUE — proven by the RECOVERY PASS)

The conductor holds **NO durable state** — its durable state is rediscovered from two
sources on every startup via the RECOVERY PASS:
  (a) The **foundry log's `built` items** — `foundry_status`'s `BUILT (awaiting merge)`
      section lists each built item + its `prRef` natively (exact, no reconstruction).
  (b) **GitHub open PRs** (`gh pr list --state open`) — backstop for PRs opened before a
      built-release landed; feat/<slug> branch matching fills any gaps.

Both sources are durable; the in-context awaiting-merge set is just a cache the RECOVERY
PASS rebuilds. This makes stateless restart **true** in practice, not just in theory:

When context nears critical, the conductor stops cleanly and reports its surface state.
A fresh conductor (or a superconductor) runs the RECOVERY PASS on startup, rebuilds the
awaiting-merge set from the foundry's built items (exact) + gh backstop, and continues
exactly where the previous conductor left off — no coordinator handoff, no state
serialization, no leader-election. A built-but-unmerged PR is NEVER re-built (the
RECOVERY PASS finds it and routes it to the MERGE PASS).

"Store generators, derive graphs" applied to the conductor itself: the conductor IS a
generator, not a graph.

On the context-critical stop itself (loop step e), report:
  - awaiting-merge set (itemId, prRef, waveVerdict, gate status for each)
  - any pending founder gates (itemId, gate type, prRef)
  - stop reason: "context-critical — foundry state is durable; re-launch a fresh
    conductor to resume (it re-polls foundry_next; no handoff needed)"
A FRESH CONDUCTOR continues seamlessly — the foundry event log is the only authority;
the conductor holds zero durable state of its own.
