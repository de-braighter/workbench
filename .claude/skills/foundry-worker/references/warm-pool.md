# Warm pool (Phase 2 ISOLATE — throughput optimization)

> Load this when you want to skip the cold `git worktree add` and reuse a warm slot
> (preserves `node_modules`). The pool is a **throughput layer, NEVER a correctness
> dependency** — on any failure, fall back to the cold `git worktree add` recipe in
> the core SKILL.md Phase 2.

**Warm pool (throughput; correctness never depends on it; AUTO-ENGAGED via self-lease).**
After you CLAIM (Phase 1 — you now hold a `claimId`), lease your own warm slot. The foundry
allocates your slot **index** under the same store-lock that arbitrates `claim()`, so the index
is collision-free across ALL coordinators (N conductors, every superconductor lane, or a lone
item-/pool-mode worker) **by construction** — call the MCP tool:

> `foundry_lease_slot { claimId: <your claimId> }`  →  `{ slotIndex, repo, claimId }`

Then reset-on-lease that warm slot (preserves `node_modules`) instead of the cold `git worktree
add`. Pass an **absolute** repoRoot so the returned slot path is absolute and `cd`-able:

```bash
REPO_ABS=$(cd <repo-local-path> && pwd)   # ABSOLUTE — the CLI returns join(REPO_ABS, .claude/wt-pool/slot-N), absolute
# exclude the pool dir in the TARGET repo (domains/foundry already gitignores it; OTHER repos need this):
grep -q '\.claude/wt-pool/' "$REPO_ABS/.gitignore" "$REPO_ABS/.git/info/exclude" 2>/dev/null \
  || echo '.claude/wt-pool/' >> "$REPO_ABS/.git/info/exclude"
# <slotIndex> = the integer foundry_lease_slot returned above:
SLOT=$(cd domains/foundry && npm run -s wt-pool -- lease "$REPO_ABS" feat/<slug> <slotIndex> origin/main)
SLOT="${SLOT//\\//}"   # normalize win32 backslashes for POSIX cd
if [ -n "$SLOT" ] && cd "$SLOT" 2>/dev/null; then
  : # leased: pristine tree + warm node_modules, already on feat/<slug>
else
  : # lease failed/empty → FALL BACK to the cold `git worktree add` recipe above
fi
```

**On ANY failure — `foundry_lease_slot` rejects (unknown/ended/superseded claim), the CLI exits
non-zero, or `$SLOT` is empty — fall back to the cold `git worktree add` recipe above.** The pool
is a throughput layer, NEVER a correctness dependency; the guarded `cd` (`[ -n "$SLOT" ]`) ensures
a failed lease never leaves you building in the wrong cwd. If `foundry_lease_slot` rejects because
your claim has expired (the error names "expired — heartbeat to revive"), `foundry_heartbeat { claimId }`
to revive, then re-lease (or cold-add).

**A warm slot is NOT torn down on release** — the pool reuses it (the next lease resets it to a
pristine tree). Only a *cold* `git worktree add` at `.claude/worktrees/<slug>` gets removed in
Phase 5 cleanup; a leased `.claude/wt-pool/slot-N` is left in place for the next worker.

> **Why self-lease (multi-coordinator per-slot lease — slice 3, shipped foundry#6):** the worker
> allocating its OWN index via `foundry_lease_slot` (the lease is bound to your `claimId` and frees
> when the claim releases / hands off / TTL-expires) is collision-safe across N coordinators because
> the foundry's single store-lock serializes every allocation — the same arbiter that makes `claim()`
> safe. This **replaces** the earlier "the conductor threads a `<slotIndex>` into the dispatch prompt"
> idea, which collided under the superconductor (two conductors on one repo would both lease slot-0).
> There is nothing for a conductor to thread: every fanned-out worker self-leases a distinct slot
> **within its repo** (allocation is per-repo, so workers on different repos may share an index —
> harmless, the physical `<repo>/.claude/wt-pool/slot-N` paths differ).
