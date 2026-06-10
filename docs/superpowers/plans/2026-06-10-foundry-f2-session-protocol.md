# Foundry F2 — Session Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the spec-§5 session protocol executable: a canonical `foundry-worker` boot skill in the workbench, the claim + worktree mandate in `policies/git.md`, a hand-craft session-prompt template, and a one-line alignment of foundry's `renderSessionPrompt` to point at the skill.

**Architecture:** The skill is the single source of truth for the protocol (detailed, versioned in the workbench); foundry's generated prompt becomes a compact bootstrap that invokes the skill, keeping its 6-step summary as a degraded-mode fallback. Two PRs: **PR A** (workbench: skill + policy + template + this plan) and **PR B** (foundry: prompt alignment, TDD). PR A is itself built in a git worktree — dogfooding the mandate it ships.

**Tech Stack:** Markdown (workbench is declarative-only — no code there); TypeScript + vitest for the small foundry change.

**Spec:** `docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md` §5 (session protocol), §3 (risk tiers), §7 (failure stances), §6 row F2.

---

## Gap-closure decisions (the spec leaves these open; ratified for this plan)

1. **Protocol home** — `.claude/skills/foundry-worker/SKILL.md` is canonical; `renderSessionPrompt` references it and keeps the 6-step summary as fallback (sessions are always launched from the cluster root, so the skill is present; the fallback covers misconfiguration).
2. **Claim/worktree ordering** — compute slug/branch/worktree path deterministically from the itemId BEFORE claiming; `foundry_claim` carries the *planned* values; worktree creation happens after. Worktree failure → `foundry_release(blocked)`. Never the reverse: an unclaimed worktree is harmless, unclaimed *work* breaks fail-closed.
3. **Worktree convention** — `<repo>/.claude/worktrees/<item-slug>`, branch `feat/<item-slug>` (matches the verifier-agent + devloop#29 convention). Repos that don't gitignore `.claude/worktrees/` get a local-only `.git/info/exclude` entry (no PR pollution).
4. **Session id** — minted once at boot: `sess-<yyyyMMdd-HHmmss>-<4 hex>`; reused for every foundry call.
5. **Tier→gate mapping** (concretizes spec §3): T0 = standard wave, auto-merge on green; T1 = wave + Sonar gate + `Effort: deep` on kernel-touching items; T2 = designer-first mandatory + full battery + `foundry_gate_request(ship)` before merge — never auto-merge.
6. **Scope confinement** — deterministic pre-PR check: `git diff --name-only origin/main...HEAD` ⊆ scope `pathPrefix` (when set); out-of-scope discovery follows spec §7 (older claim proceeds, newer hands off).
7. **Producer attribution** — worker sessions declare `Producer: foundry-worker/<model> [skills…]` so devloop calibration can stratify foundry-spawned sessions from orchestrator sessions.

## File structure (lock-in)

```text
de-braighter/ (workbench, PR A — built in worktree .claude/worktrees/f2-session-protocol)
├── .claude/skills/foundry-worker/SKILL.md        # NEW — the canonical session protocol
├── policies/git.md                               # MODIFY — "Claims & worktrees" section
├── templates/session-prompt/template.md          # NEW — hand-craft prompt template
└── docs/superpowers/plans/2026-06-10-foundry-f2-session-protocol.md  # this plan

domains/foundry/ (PR B)
├── src/prompts.ts                                # MODIFY — skill-reference line
└── test/prompts-status.test.ts                   # MODIFY — assert the reference
```

---

### Task 1: Workbench worktree + branch (dogfood the mandate)

**Files:** none (git plumbing only)

The workbench main clone carries unrelated untracked WIP and may host concurrent sessions — exactly the wound the worktree mandate closes. Build PR A in a worktree.

- [ ] **Step 1: Ensure worktrees are locally excluded** (workbench `.gitignore` does NOT cover `.claude/worktrees/`)

```bash
cd D:/development/projects/de-braighter
grep -qx '.claude/worktrees/' .git/info/exclude 2>/dev/null || echo '.claude/worktrees/' >> .git/info/exclude
```

- [ ] **Step 2: Create the worktree on a fresh branch off origin/main**

```bash
cd D:/development/projects/de-braighter
git fetch origin main
git worktree add .claude/worktrees/f2-session-protocol -b feat/f2-session-protocol origin/main
```

Expected: `Preparing worktree (new branch 'feat/f2-session-protocol')`. ALL subsequent PR-A tasks operate inside `D:/development/projects/de-braighter/.claude/worktrees/f2-session-protocol/`. Never `git add -A` (workbench hygiene rule holds in the worktree too — use explicit paths).

---

### Task 2: `foundry-worker` skill — the canonical protocol

**Files:**
- Create: `.claude/worktrees/f2-session-protocol/.claude/skills/foundry-worker/SKILL.md`

- [ ] **Step 1: Write the skill file** (complete content):

````markdown
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
- **Scope is a hard boundary.** Touch nothing outside the item's scope. Same-repo
  disjointness is proven by non-nested pathPrefixes or distinct issues (the
  server's rules); pathPrefix is the boundary you can CHECK against the diff.
- **One item per session.** Release, report, stop.

## Phase 0 — BOOT

1. Mint a session id once and reuse it for every foundry call:
   `sess-<yyyyMMdd-HHmmss>-<4 hex>` (e.g. `sess-20260610-143012-a3f9`).
2. Identify the item: the launch prompt names it. Launched without one →
   `foundry_next` (limit 3) and take the TOP item — the extras are context only;
   do NOT pick a different item than the prompt's unless the founder said so.
3. Derive, before claiming:
   - **slug** — itemId lowercased, every non-`[a-z0-9]` run → `-`
     (`agri/E1.1` → `agri-e1-1`)
   - **branch** — `feat/<slug>`
   - **repo local path** — scope repo `de-braighter/<name>` →
     `domains/<name>/` or `layers/<name>/` (whichever exists under the cluster
     root); `de-braighter/workbench` → the cluster root itself
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
   agents lose verdict capture):
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
| Claim rejected | Stop, report which conflict. |
| Worktree creation fails | `foundry_release(blocked)` + note. |
| Scope overlap discovered mid-build | Older claim proceeds; newer `foundry_handoff` + stop. |
| Quality floor red | `foundry_release(blocked)` with the failure attached. |
| Build dead-ends mid-EXECUTE (infeasible / unresolvable) | `foundry_release(blocked)` + why — never hold the claim until TTL. |
| Heartbeat errors (claim superseded) | Stop working immediately; report. |
| Founder gate still pending at session end | `foundry_release(blocked)` + note the gateId — the item re-queues; a later session merges after approval. Gates never block other products' lanes. |
````

- [ ] **Step 2: Verify frontmatter + structure**

Run: `head -6 .claude/skills/foundry-worker/SKILL.md` (from the worktree). Expected: YAML frontmatter with `name: foundry-worker`, a trigger-focused `description`, `tags`.

- [ ] **Step 3: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f2-session-protocol
git add .claude/skills/foundry-worker/SKILL.md
git commit -m "feat(skills): foundry-worker — the F2 session protocol (claim, isolate, execute, quality, land, release)"
```

---

### Task 3: Worktree mandate + claim protocol in `policies/git.md`

**Files:**
- Modify: `.claude/worktrees/f2-session-protocol/policies/git.md` (insert after the `## PR-everywhere` section; update frontmatter `last_updated`)

- [ ] **Step 1: Update frontmatter date**

Change `last_updated: 2026-05-24` → `last_updated: 2026-06-10`.

- [ ] **Step 2: Insert the new section** between `## PR-everywhere` and `## Verifier wave`:

```markdown
## Claims & worktrees (multi-session safety)

Concurrent sessions sharing one clone switch branches under each other — the
worktree mandate closes this structurally (Foundry spec §5: "No session ever
works in the shared clone").

- **Foundry-tracked work is claim-gated.** A session working a Foundry queue
  item follows `.claude/skills/foundry-worker/SKILL.md`: atomic `foundry_claim`
  at session start (BEFORE any write), then a dedicated git worktree at
  `<repo>/.claude/worktrees/<item-slug>` on branch `feat/<item-slug>`, release
  on completion. Repos that don't gitignore `.claude/worktrees/` get a
  local-only `.git/info/exclude` entry.
- **Fail closed.** Foundry MCP unavailable or claim rejected → do not start the
  work (read-only at most). A generated session prompt holds no lock — only
  `foundry_claim` does.
- **Everywhere else, prefer worktrees.** Whenever another session may be active
  in the same repo, work in a worktree (verifier agents already do, via
  `isolation: "worktree"`); at minimum verify the branch before every commit.
- **Stale claims** (TTL 240 min without heartbeat) surface in `foundry_status`
  with their abandoned worktree path for cleanup; reclaim is explicit, never silent.
```

- [ ] **Step 3: Verify placement**

Run: `grep -n '^## ' policies/git.md` (from the worktree). Expected order: `PR-everywhere`, `Claims & worktrees (multi-session safety)`, `Verifier wave`, `Sonar quality gate…`, `Hard rules`, …

- [ ] **Step 4: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f2-session-protocol
git add policies/git.md
git commit -m "docs(policies): claims + worktree mandate — the F2 session-protocol rules in git.md"
```

---

### Task 4: Session-prompt template (hand-craft path)

**Files:**
- Create: `.claude/worktrees/f2-session-protocol/templates/session-prompt/template.md`

- [ ] **Step 1: Write the template** (complete content — the prompt block mirrors `domains/foundry/src/prompts.ts` `renderSessionPrompt` field-for-field):

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f2-session-protocol
git add templates/session-prompt/template.md
git commit -m "docs(templates): worker-session prompt template (hybrid spawn, mirrors renderSessionPrompt)"
```

---

### Task 5: Add this plan to PR A

**Files:**
- Create (copy): `.claude/worktrees/f2-session-protocol/docs/superpowers/plans/2026-06-10-foundry-f2-session-protocol.md`

- [ ] **Step 1: Copy the plan from the main clone into the worktree**

```powershell
Copy-Item "D:/development/projects/de-braighter/docs/superpowers/plans/2026-06-10-foundry-f2-session-protocol.md" "D:/development/projects/de-braighter/.claude/worktrees/f2-session-protocol/docs/superpowers/plans/"
```

- [ ] **Step 2: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f2-session-protocol
git add docs/superpowers/plans/2026-06-10-foundry-f2-session-protocol.md
git commit -m "docs(plan): F2 session protocol — gap decisions + 8-task plan"
```

---

### Task 6: Push + open PR A (workbench)

**Files:** none (git/gh only)

- [ ] **Step 1: Push the branch**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f2-session-protocol
git push -u origin feat/f2-session-protocol
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --repo de-braighter/workbench --title "feat(skills+policies): F2 session protocol — foundry-worker skill, worktree mandate, prompt template" --body "$(cat <<'EOF'
## F2 — Session protocol (Foundry spec §5)

- `.claude/skills/foundry-worker/SKILL.md` — canonical worker-session protocol: atomic claim → worktree isolation → execute via existing skills → tier-gated quality (T0/T1/T2) → PR + twin ritual → release. Fail-closed stances per spec §7.
- `policies/git.md` — new "Claims & worktrees (multi-session safety)" section: claim-gated foundry work, the worktree mandate, fail-closed rule, stale-claim surfacing.
- `templates/session-prompt/template.md` — hand-craft template mirroring foundry's `renderSessionPrompt`.
- Plan with the 7 gap-closure decisions: `docs/superpowers/plans/2026-06-10-foundry-f2-session-protocol.md`.

Companion: de-braighter/foundry PR (renderSessionPrompt → skill reference).
Built in a git worktree — dogfooding the mandate it ships.

Producer: orchestrator/claude-fable-5 [superpowers:brainstorming, superpowers:writing-plans, superpowers:subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert
Effect: findings 2±2 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then the orchestrator (not a plan step) runs the verifier wave FOREGROUND (`reviewer` + `qa-engineer` + `charter-checker`; `local-ci` N/A — the workbench has no build), posts findings BEFORE fix commits, merges on green, runs the twin ritual, and removes the worktree (`git worktree remove .claude/worktrees/f2-session-protocol`).

---

### Task 7: Foundry prompt alignment (TDD)

**Files:**
- Modify: `domains/foundry/src/prompts.ts`
- Modify: `domains/foundry/test/prompts-status.test.ts`

- [ ] **Step 1: Branch off main**

```bash
cd D:/development/projects/de-braighter/domains/foundry
git checkout main && git pull origin main
git checkout -b feat/f2-prompt-skill-alignment
```

- [ ] **Step 2: Write the failing test** — in `test/prompts-status.test.ts`, first test (`returns mutually scope-disjoint prompts embedding the protocol`), add after `expect(text).toContain('Producer:');`:

```typescript
    expect(text).toContain('foundry-worker'); // F2: prompt bootstraps into the canonical skill
    expect(text).toContain('prRef: "<owner>/<repo>#<pr>"'); // full form — devloop tooling 404s on short
    expect(text).toContain('worktree, branch }'); // claim carries the planned isolation up front
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/prompts-status.test.ts`
Expected: FAIL — `expected ... to contain 'foundry-worker'`.

- [ ] **Step 4: Implement** — in `src/prompts.ts`, four line changes in the template string (everything else unchanged — the 6 steps stay as the degraded-mode fallback):

(a) Change

```text
Protocol — mandatory, in order:
```

to

```text
Invoke the workbench skill foundry-worker (Skill tool) and follow it end to end — it is the canonical session protocol. Fallback protocol if the skill is unavailable — mandatory, in order:
```

(b) Replace protocol steps 1–2 (the claim-ordering trap: the old step 2 told the session to pass worktree/branch to a `foundry_claim` call that already happened — a second claim by the same session is rejected by `ops.ts`):

```text
1. CLAIM — call foundry MCP tool foundry_claim with { itemId: ${JSON.stringify(i.itemId)}, sessionId: "<your session id>" }. If rejected, STOP immediately; never work unclaimed.
2. ISOLATE — create a git worktree for this claim and work only there; never in the shared clone. Pass the worktree path and branch to foundry_claim.
```

becomes

```text
1. CLAIM — mint a session id (sess-<yyyyMMdd-HHmmss>-<4 hex>), derive your worktree (<repo-local-path>/.claude/worktrees/<item-slug>) and branch (feat/<item-slug>), then call foundry MCP tool foundry_claim with { itemId: ${JSON.stringify(i.itemId)}, sessionId, worktree, branch }. If rejected, STOP immediately; never work unclaimed.
2. ISOLATE — create the claimed git worktree and work only there; never in the shared clone.
```

(c) In step 6 of the protocol change `prRef: "<repo>#<pr>"` to `prRef: "<owner>/<repo>#<pr>"` (mirror fidelity with the skill + template; the full form is what `post-findings`/`backfill` require).

- [ ] **Step 5: Run the full suite**

Run: `cd domains/foundry && npm run ci:local`
Expected: typecheck green, all 64+1 tests green (do NOT pipe through `2>$null` — PS 5.1 NativeCommandError breaks vitest).

- [ ] **Step 6: Commit**

```bash
cd D:/development/projects/de-braighter/domains/foundry
git add src/prompts.ts test/prompts-status.test.ts
git commit -m "feat(prompts): session prompt bootstraps into the foundry-worker skill (F2 alignment)"
```

---

### Task 8: Push + open PR B (foundry)

**Files:** none (git/gh only)

- [ ] **Step 1: Push + PR**

```bash
cd D:/development/projects/de-braighter/domains/foundry
git push -u origin feat/f2-prompt-skill-alignment
gh pr create --repo de-braighter/foundry --title "feat(prompts): bootstrap worker sessions into the foundry-worker skill (F2)" --body "$(cat <<'EOF'
## F2 alignment — prompt → skill

renderSessionPrompt now tells the session to invoke the workbench `foundry-worker`
skill (the canonical protocol, single source of truth); the inline 6-step summary
stays as the degraded-mode fallback. Also fixes the claim-ordering trap (worktree +
branch are derived and passed AT claim time — the old step 2 told sessions to pass
them to a claim call that had already happened and would be rejected on retry) and
aligns the prRef placeholder to the full `<owner>/<repo>#<pr>` form.

Companion: de-braighter/workbench F2 PR (the skill itself).

Producer: orchestrator/claude-fable-5 [superpowers:subagent-driven-development, superpowers:test-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then the orchestrator runs the wave (`local-ci` + `reviewer` + `qa-engineer`, foreground, `isolation: "worktree"`; `charter-checker` N/A as in F1), `post-findings` before fixes, merges on green, twin ritual (`drain de-braighter/foundry#<pr>` → `backfill` → `reconcile`).

---

## Self-review notes (run during plan-writing)

- **Spec coverage:** §5 steps 1–6 → skill Phases 1–6 (boot split out as Phase 0); §5 crash recovery → stale-claim quickref + heartbeat-error stance; §3 tier table → Phase 4/5 tier mapping (decision 5); §7 stances → skill quickref table (all five rows); §6 F2 deliverables: boot/claim skill (Task 2), worktree mandate in policies/git.md (Task 3), prompt templates (Task 4 + PR B alignment Tasks 7–8).
- **Placeholder scan:** none — every artifact's full content is in its task.
- **Consistency:** worktree path/branch/slug conventions identical across skill (Phase 0/2), policy section, and Task 1's dogfood; the template's prompt block matches `renderSessionPrompt` post-PR-B verbatim (the skill line, the claim-step rewrite, and the full-form prRef included); `post-findings` full-form `owner/repo#pr` everywhere. Quality-review round accepted 1 MUST-FIX (claim-ordering trap) + 6 SHOULD-FIXes + 6 nits; won't-fix: the new git.md section's ~78-col hard wrap (self-consistent style). Verifier-wave round (workbench#111) accepted 2 BLOCKING (slug-collision guard on destructive worktree recovery; mid-EXECUTE dead-end release stance) + 2 SHOULD-FIX (issue-grain in the scope hard rule; explicit gate-pending release call) + 3 nits (drain/backfill form clarifier, node_modules comment, session-id mint in the fallback — the last flows into PR B's prompts.ts); won't-fix: grep-variant alignment (both correct), plan frontmatter (matches every existing plan), unchecked checkboxes (plans commit as authored), PR-B window (closed by landing PR B in the same arc).
