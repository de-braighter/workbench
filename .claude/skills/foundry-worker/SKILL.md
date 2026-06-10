---
name: foundry-worker
description: "Foundry worker-session boot protocol — atomically claim ONE work item, isolate in a git worktree, execute via existing skills, pass tier-gated quality, land the PR with the twin ritual, release the claim. Use when a pasted session prompt names a foundry work item, or when asked to work an item from the foundry queue."
tags: [foundry, session-protocol, autonomous]
---

# Foundry Worker Session

One session works EXACTLY one claimed item under the session protocol
(spec §5/§7: `docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md`),
then stops. The Foundry adds no new way to build — this skill routes to the
existing arsenal and adds only collision safety + tier-gated quality.

## Hard rules (fail closed)

- **Never work a queue item unclaimed.** `foundry_*` tools unavailable, store
  errors, or claim rejected → stop (read-only diagnosis at most). A pasted
  session prompt holds no lock; only `foundry_claim` does.
- **Never edit in the shared clone.** Every write happens in the claim's worktree.
- **Never bypass quality gates.** Floor can't go green → release `blocked`.
- **Scope is a hard boundary.** Touch nothing outside the item's repo/issue/pathPrefix.
- **One item per session.** Release, report, stop.

## Phase 0 — BOOT

1. Mint a session id once and reuse it for every foundry call:
   `sess-<yyyyMMdd-HHmmss>-<4 hex>` (e.g. `sess-20260610-143012-a3f9`).
2. Identify the item: the launch prompt names it. Launched without one →
   `foundry_next` (limit 3) and take the top item; do NOT pick a different item
   than the prompt's unless the founder said so.
3. Derive, before claiming:
   - **slug** — itemId lowercased, every non-`[a-z0-9]` run → `-`
     (`agri/E1.1` → `agri-e1-1`)
   - **branch** — `feat/<slug>`
   - **repo local path** — scope repo `de-braighter/<name>` →
     `domains/<name>/` or `layers/<name>/` (whichever exists under the cluster root)
   - **worktree** — `<repo-local-path>/.claude/worktrees/<slug>`
4. Optional sanity: `foundry_status` (board view; stale claims list abandoned worktrees).

## Phase 1 — CLAIM (before any write)

```text
foundry_claim { itemId, sessionId, worktree: <planned path>, branch: <planned branch> }
```

- Rejected (already claimed / scope overlap / dependencies not done) → report and **STOP**.
- Keep the returned `claimId`. Heartbeat discipline from here on:
  `foundry_heartbeat { claimId }` at every phase boundary and at least every
  2 hours (TTL 240 min). A heartbeat **error** means the claim was superseded —
  stop working immediately.

## Phase 2 — ISOLATE

From the target repo root:

```bash
cd <repo-local-path>
git fetch origin main
# local-only exclude if the repo doesn't ignore worktrees (no PR pollution):
grep -q '\.claude/worktrees/' .gitignore || echo '.claude/worktrees/' >> .git/info/exclude
git worktree add .claude/worktrees/<slug> -b feat/<slug> origin/main
cd .claude/worktrees/<slug>
npm install   # worktrees don't share node_modules
```

- Worktree creation fails (or a stale worktree/branch from an expired claim is
  unrecoverable) → `foundry_release { claimId, outcome: "blocked", note }` and stop.
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

## Phase 4 — QUALITY (tier-gated; PR opens BEFORE the wave)

1. Repo gate green in the worktree: `npm run ci:local`.
2. Scope confinement: `git diff --name-only origin/main...HEAD` — every path
   inside the scope `pathPrefix` (when set). Out-of-scope file → revert it or handoff.
3. Push the branch, open the PR (template: `templates/pr/template.md`) — the PR
   must exist before the wave so findings are postable. Body carries
   (per `policies/git.md`):
   - `Producer: foundry-worker/<model> [skill1, skill2]`
   - `Effort: light|standard|deep` (anchored: light = no wave; standard = wave;
     deep = wave + designer-first and/or ≥2 review rounds)
   - `Effect:` only when defensible — prefer `cycle-time` / `findings`
     (same-session merge cycle-time ≈ 0.005–0.01 h).
4. Verifier wave per tier — **foreground, never `run_in_background`** (background
   agents lose verdict capture):
   - **T0** — standard wave (`workflows/verifier-wave.md`).
   - **T1** — wave + Sonar gate (`npm run ci:sonar` / `sonar:scan` where wired) +
     `Effort: deep` on kernel-touching items.
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
   payloadRef: <pr url> }` and WAIT for the founder — never auto-merge.
2. Twin ritual (mandatory, from `domains/devloop`): after the wave
   `npm run dev -- drain <repo#pr>`; after merge `npm run dev -- backfill`
   (full `OWNER/REPO`) then `npm run dev -- reconcile`;
   `npm run ritual:post-merge` covers reviews + resolve-findings.
3. Cleanup from the repo root: `git worktree remove .claude/worktrees/<slug>`
   (add `--force` only if the worktree is dirty by design), delete the merged branch.

## Phase 6 — RELEASE

```text
foundry_release { claimId, outcome: "done", prRef: "<owner>/<repo>#<pr>" }
```

Then STOP. Final report: item, PR, wave verdicts, ritual confirmations, claim released.

## Failure stances quickref (spec §7)

| Situation | Action |
| --- | --- |
| Foundry MCP unavailable / store corrupt | No claim → no work. Stop, report. |
| Claim rejected | Stop, report which conflict. |
| Worktree creation fails | `foundry_release(blocked)` + note. |
| Scope overlap discovered mid-build | Older claim proceeds; newer `foundry_handoff` + stop. |
| Quality floor red | `foundry_release(blocked)` with the failure attached. |
| Heartbeat errors (claim superseded) | Stop working immediately; report. |
| Founder gate still pending at session end | `foundry_release(blocked)` + note the gateId — the item re-queues; a later session merges after approval. Gates never block other products' lanes. |
