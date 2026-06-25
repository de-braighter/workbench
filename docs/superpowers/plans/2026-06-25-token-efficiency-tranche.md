# Token-Efficiency Tranche — TE1 (ritual consolidation) + TE2 (progressive-disclosure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. **This plan is the input to the foundry `/build-path`** — each Task maps 1:1 to a foundry work item (TE1/TE2). Design basis: `docs/token-consumption-audit-2026-06-25.md` (items W2 + W7); W1 (MEMORY.md) already under-limit; W6 (PR-lines) deferred.

**Goal:** Realize the audit's two durable, drop-surviving token wins — collapse the AI-narrated twin ritual into ONE command (W2), and progressive-disclosure-split the two heaviest per-run skills (W7) — without changing any behavior.

**Architecture:** TE1 extends the existing `ritual:post-merge` script to run the full `drain → backfill → reconcile` sequence from a single `<repo#pr>` arg (one Bash call replaces ~5 narrated ones; no git hook — squash-merge-on-GitHub doesn't fire local hooks usefully). TE2 splits `foundry-worker` + `foundry-conduct` SKILL.md into a lean happy-path core + on-demand `references/` files, preserving the protocol verbatim.

**Tech Stack:** Node/npm scripts (devloop/twin), markdown (workbench `.claude/skills`, docs).

## Global Constraints

- **Quality-neutral — behavior unchanged.** The audit's principle: *less tokens iff quality is not tangled.* TE1 must run the IDENTICAL ritual sequence; TE2 must preserve the worker/conductor protocol verbatim (lossless reorganization).
- **Do NOT touch the foundry-OWNED region of `policies/git.md`** (the `<!-- governance:review-floor:start/end -->` block, D5). TE1 edits only the *twin-ritual* section + the CLAUDE.md ritual block (both un-owned, hand-editable).
- **Verify the move landed** (audit §Reproduce): TE1 → the one command reproduces the multi-step ritual's effect; TE2 → the split SKILL.md still loads + the core retains the happy-path protocol (a reviewer reads core-only and can still execute a worker run).
- **Per-repo CI:** the ritual-script repo (devloop/twin) → its `ci:local`; workbench skills/docs are declarative (markdown) — lint via `md-quality-review` if wired.
- **No founder gate** (tooling + skill-refactor + un-owned-doc edits; no governance-prose rewrite). **Zero kernel change.**
- **Product home:** `system-builder-studio`, keys `TE1`/`TE2`.

---

## Task TE1: Consolidate the twin ritual into one command (W2)

**Files:**
- Modify: the `ritual:post-merge` script + its `package.json` script entry — locate it first: `grep -rl "ritual:post-merge" domains/devloop domains/foundry/twin` (it bundles `reviews`+`resolve-findings` today per the audit).
- Modify: `policies/git.md` (the **"Feeding the twin — the per-PR ritual"** section only — NOT the owned review-floor block) + `CLAUDE.md` (the twin-ritual block) — update the documented invocation to the single command.

**Scope:** the ritual-script repo (`domains/devloop` or `domains/foundry/twin`) + `de-braighter/workbench` docs. **DependsOn:** none. **Quality:** wave-standard + behavior-parity check.

**Interfaces:** Produces a single command `npm run ritual:post-merge -- <repo#pr>` (or `npm run dev -- ritual <repo#pr>`) that runs, in order: `drain <repo#pr>` → `backfill <owner/repo>` (derive owner/repo from the `<repo#pr>` arg) → `reconcile` → the existing `reviews` + `resolve-findings`. Idempotent (each underlying step already is).

- [ ] **Step 1: Locate + read** the current `ritual:post-merge` script + the `drain`/`backfill`/`reconcile` CLI entrypoints (`grep -rl "ritual:post-merge"` then read the script + the devloop `dev` CLI). Confirm the exact arg shapes (`drain` takes `<repo#pr>`; `backfill` takes `<owner/repo>`; `reconcile` no args) — the audit + memory note `backfill` is repo-level + `drain`/`reconcile` take short forms.
- [ ] **Step 2: Write a failing test** (or a parity check if the repo has no test harness for scripts): a unit/integration test that invoking the consolidated command with a `<repo#pr>` calls drain(repo#pr) → backfill(owner/repo) → reconcile() → reviews → resolve-findings in order. If scripts aren't unit-testable, write a dry-run/echo mode asserted by a shell test.
- [ ] **Step 3: Implement** — extend `ritual:post-merge` to accept `<repo#pr>`, parse `owner/repo` from it, and run the full sequence (drain → backfill → reconcile → reviews → resolve-findings). Keep each step's existing idempotency; fail loud if a step errors (don't silently continue).
- [ ] **Step 4: Run green** + a real dry-run against a recently-merged PR (e.g. a D5.x PR) confirming the sequence executes (or no-ops idempotently) in ONE invocation.
- [ ] **Step 5: Update the docs** — in `policies/git.md` "Feeding the twin" section + the `CLAUDE.md` ritual block, replace the multi-line `drain` / `backfill` / `reconcile` recipe with the single `npm run ritual:post-merge -- <repo#pr>` call (note it bundles all steps). **Leave the `<!-- governance:review-floor -->` owned block untouched.**
- [ ] **Step 6: Verifier wave** (reviewer + qa + charter, FOREGROUND, read return-values) — confirm behavior parity (same ritual effect) + zero kernel change. Open PR(s) (script repo + workbench docs may be 2 PRs; `Producer:`/`Effort: standard`); `foundry_release{built}`.

---

## Task TE2: Progressive-disclosure split of the two heaviest skills (W7)

**Files:**
- Modify: `.claude/skills/foundry-worker/SKILL.md` (17.7KB) + create `.claude/skills/foundry-worker/references/*.md`.
- Modify: `.claude/skills/foundry-conduct/SKILL.md` (40KB) + create `.claude/skills/foundry-conduct/references/*.md`.

**Scope:** `de-braighter/workbench`, pathPrefix `.claude/skills/foundry-worker` + `.claude/skills/foundry-conduct`. **DependsOn:** none (independent of TE1). **Quality:** wave-standard + protocol-preservation check.

**Interfaces:** Produces a lean **core** SKILL.md per skill (the happy-path protocol a normal run needs) + `references/<topic>.md` files (edge cases, recovery, rare branches) linked from the core with a one-line "load `references/X.md` when …" pointer.

- [ ] **Step 1: Read both SKILL.md** fully. Classify each section as **happy-path core** (every run needs it — the claim→build→wave→merge/conduct loop, the hard rules, the concurrency guards) vs **edge/reference** (recovery passes, rare error modes, multi-variant detail, long examples, deferred-feature notes).
- [ ] **Step 2: Split `foundry-worker`** — keep the core protocol in SKILL.md; move edge-case/recovery/rare-branch content to `references/{recovery,edge-cases,...}.md`; in the core, add a short "When you hit <X>, read `references/<file>.md`" pointer for each moved block. The core MUST be self-sufficient for a clean happy-path worker run.
- [ ] **Step 3: Split `foundry-conduct`** the same way (it's the biggest — 40KB; the per-product conductor read). Keep the claim→build→wave→merge cycle + the inviolable merge rules + the IDLE/filler ladder summary in core; move the long rationale, the fan-out capability matrix detail, and rare-path handling to `references/`.
- [ ] **Step 4: Verify lossless + loadable** — diff the union (core + references) against the original to confirm NO protocol content was dropped (only relocated). Confirm the SKILL.md frontmatter + structure still parse as a valid skill. A reviewer reading core-only must be able to execute a standard run; an edge case must be reachable via the pointer.
- [ ] **Step 5: Verifier wave** (reviewer + charter + qa, FOREGROUND, read return-values) — reviewer confirms protocol-preservation (lossless split, core self-sufficient, pointers resolve); charter confirms no governance/behavior change. Open PR (`Producer:`/`Effort: standard`); `foundry_release{built}`.

---

## Self-Review

**Spec/audit coverage:** W2 → TE1 (one-command consolidation, no git hook); W7 → TE2 (core + references/ split of the 2 heaviest skills); W1 already under-limit (no task); W6 deferred (noted). The audit's "scriptify > trim" + "behavior-neutral" principles are the Global Constraints.

**Placeholder scan:** the `grep -rl "ritual:post-merge"` locate-step (TE1) is an explicit discovery instruction, not a TODO (the script's exact repo/path is confirmed by the worker, not guessed). No other placeholders.

**Type/contract consistency:** the consolidated command's step order (drain → backfill → reconcile → reviews → resolve-findings) is stated once (TE1 Interfaces) + reused in Steps 2/3; TE2's "core self-sufficient + pointers resolve" invariant is consistent across Steps 2/3/4.

## Dependency / scope summary (for `/build-path`)

| Item | Scope (repo · pathPrefix) | DependsOn | Gate |
|---|---|---|---|
| TE1 | devloop/twin (ritual script) + workbench docs (`policies/git.md` twin-section + `CLAUDE.md`) | — | — |
| TE2 | workbench · `.claude/skills/foundry-worker` + `.claude/skills/foundry-conduct` | — | — |

TE1 + TE2 are independent (disjoint scopes) → a parallel frontier from the start. No founder-gated item.
