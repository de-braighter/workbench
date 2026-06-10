---
title: Worker-session prompt (Foundry hybrid spawn)
last_updated: 2026-06-10
---

# Worker-session prompt template

The canonical generator is the `foundry_session_prompt` MCP tool — prefer
queueing the item (`foundry_queue_push`) and generating prompts over
hand-crafting. This template mirrors `domains/foundry/src/prompts.ts`
(`renderSessionPrompt`) for the rare hand-crafted case; the protocol's source
of truth is `.claude/skills/foundry-worker/SKILL.md`. The generator and this
template live in different repos — when one changes, update the counterpart in
the same change-arc.

```text
You are a Foundry worker session. Work EXACTLY one work item, then stop.

Item: <itemId> — <one-line title>
Product: <productKey> (risk tier <T0|T1|T2>) · Repo: <owner/repo>
Scope (hard boundary — do not touch anything outside it): <owner/repo>[ — issue #<N>][ — paths under <pathPrefix>]
Quality obligations (tier floor): <comma-separated; omit the line if none>

Invoke the workbench skill foundry-worker (Skill tool) and follow it end to end — it is the canonical session protocol. Fallback protocol if the skill is unavailable — mandatory, in order:
1. CLAIM — mint a session id (sess-<yyyyMMdd-HHmmss>-<4 hex>), derive your worktree (<repo-local-path>/.claude/worktrees/<item-slug>) and branch (feat/<item-slug>), then call foundry MCP tool foundry_claim with { itemId: "<itemId>", sessionId, worktree, branch }. If rejected, STOP immediately; never work unclaimed.
2. ISOLATE — create the claimed git worktree and work only there; never in the shared clone.
3. EXECUTE — implement the item within its scope. Route through existing skills (superpowers:subagent-driven-development for plan execution).
4. QUALITY — run the repo's local gates (ci:local) and the verifier wave per risk tier <tier>; post findings to the PR before merge.
5. LAND — open a PR carrying Producer:/Effort:/Effect: lines; merge per tier policy; run the devloop twin ritual (drain -> backfill -> reconcile).
6. RELEASE — call foundry_release with { claimId, outcome: "done", prRef: "<owner>/<repo>#<pr>" }; if you cannot finish, release with outcome "blocked" and a note instead.

During long work call foundry_heartbeat with your claimId at least every 2 hours, or the claim goes stale and may be reclaimed.
```

**When to hand-craft:** the item isn't queued yet (prefer queueing it first), or
an ad-hoc exploration still needs collision safety. Hand-crafted prompts MUST
keep every free-text field on one line (the generator sanitizes via `oneLine()`;
a hand-crafter is the sanitizer).
