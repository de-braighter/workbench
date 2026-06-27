# Token-Consumption Audit — de-braighter instruction surface

**Date:** 2026-06-25 · **Author:** orchestrator/claude-opus-4-8 · **Status:** measurement complete, cuts not yet applied
**Purpose:** measure the whole instruction surface, then enumerate every *quality-neutral* token cut as a claimable work item for the fusioned foundry/workbench SDLC plan tree.
**Guiding principle (founder):** *less tokens are always good if quality is not tangled.* Every item below carries an explicit quality-risk note; nothing is cut on vibes.

---

## TL;DR

- **Per-session baseline ≈ 48K tokens** (measured from real transcripts, not file bytes). Of that, **~16–18K is yours to edit**; the rest (~30K) is Claude Code's own system prompt + tool schemas + the agent/skill lists.
- **Cache-hit ratio is 97–99.5%.** The baseline is *not* being re-paid at full price. So always-on text-trimming is the **second-order** win, not the crisis.
- **The first-order win is scriptifying determinism.** Every tool call re-reads the entire growing context (a 755-turn session showed **374M** cache-read). An N-step AI-narrated ritual = N full context re-reads + output tokens; collapsing it to one script/hook call removes N−1 re-reads **and** the narration output. `settings.json` has **zero hooks** today — this lever is 100% unrealized.
- **One artifact is outright broken:** `MEMORY.md` is **30KB, over its own 24KB limit**, and the harness is truncating it every session. Fixing it is free and un-truncates recall.

---

## How this was measured

**Static** — byte counts of every instruction artifact, converted at ~4 chars/token, classified by *load class* (see cost model). Agent "description" sizes were extracted from frontmatter specifically, because that field — not the agent body — is what gets inlined into the system prompt.

**Dynamic** — parsed 12 most-recent of 145 local transcript JSONL files. Key signals:
- `cache_creation_input_tokens` on the **first** assistant turn ≈ the full always-on baseline the model actually ingested (more accurate than summing file bytes).
- `cache_read_input_tokens` summed across the session = how many times the baseline + conversation were re-read (cheap rate, but volume scales with turn count).
- `output_tokens` = full-price generation.

| session | turns | baseline | cache-read | output | cache-hit |
|---|---|---|---|---|---|
| b6cf8dbb | 755 | 48K | 374M | 2,190K | 99.4% |
| 661805a8 | 712 | 48K | 287M | 1,531K | 99.5% |
| f4f8b663 | 547 | 56K | 215M | 1,379K | 99.4% |
| 42337bce | 489 | 49K | 156M | 883K | 99.4% |
| 06bb7737 | 365 | 47K | 80M | 576K | 99.3% |

**Median first-turn baseline ≈ 48K tokens.**

---

## The cost model (why the ranking below is what it is)

Three load classes, paid at very different frequencies:

1. **Always-on** — ingested at session start, re-read (cached) every turn. Cost = `size × turns × cache-rate`. Trimming helps *long* sessions most.
2. **On-demand** — skill/agent *bodies*, policy files, workflow files. Paid only when read. 453KB of skills costs ~nothing until invoked.
3. **Per-run-amplified** — anything an autonomous loop re-reads each iteration, or each subagent re-loads. A 40KB skill read once per worker × many workers is the hidden multiplier.

**Why scriptify > trim:** a tool call re-reads the whole context. So the expensive thing about an AI-narrated ritual isn't its instruction text — it's the **round-trips** it generates (each re-reads ~48K+ and grows) plus the **output tokens** spent narrating. Determinism moved into a script/hook executes in **one** call with **zero** model narration. This dominates on autonomous foundry/superconductor sessions (the 489–755-turn rows above).

---

## Tier 1 — Always-on surface (per-artifact inventory)

| Artifact | ~Tokens | Load class | Redundant? | Scriptable? | Recommended cut | Est. saving | Quality risk |
|---|---|---|---|---|---|---|---|
| **MEMORY.md** | ~7.5K | always-on | partly (cold arcs) | no | Compact to ≤24KB limit; demote finished-arc entries to one-line pointers; push detail into topic files (the index already says to). | ~4K + **un-truncates** | **Low** — index is already meant to be one-liners; detail stays in topic files |
| **Agent descriptions ×23** | ~4.5K | always-on | some boilerplate | no | Trim the 6 fattest (`substrate-coder-pro` 1564B, `windows-devops-pro` 1387B, `i18n-pro` 946B, `swiss-pro` 932B, `substrate-architect` 913B, `fhir-pro` 897B) to ~500B: keep *trigger conditions + boundary vs sibling agents*, drop prose examples. | ~2K | **Medium** — description drives dispatch accuracy; keep the "spawn when / distinct from X" clauses, cut only narrative |
| **project CLAUDE.md** | ~3K | always-on | yes (substrate kernel explained twice; layout ASCII + prose overlap) | no | De-dup the substrate-kernel section (state the 4 concerns + inclusion test once, link ADR-176 for depth); collapse the layout tree. | ~0.8K | **Low** — depth lives in cited ADRs |
| **global CLAUDE.md** | ~1.6K | always-on (all projects) | no | no | Maven + postch gh-auth blocks are irrelevant to de-braighter sessions but load anyway. Acceptable, or move to a `D:/work`-scoped file. | ~0.6K | **Low** — but cross-project; verify D:/work still gets them |
| **AGENTS.md** | 0 (to Claude) | not loaded by Claude Code | **yes — 74/107 lines identical to CLAUDE.md** (Codex clone) | n/a | No Claude token cost. *Maintenance* redundancy only — generate it from CLAUDE.md via a build step instead of hand-syncing. | 0 tokens, −1 sync burden | **Low** |

**Tier-1 realistic trim: ~7K off a 48K baseline (~14%).** On a 700-turn run that's ~4.9M fewer cache-read tokens; modest in dollars, but MEMORY.md fix is worth it for correctness alone.

---

## Tier 2 — Scriptify-determinism inventory (the bigger lever)

These are currently **AI-orchestrated** (the model makes N tool calls + narrates). Each is a candidate to become a **hook** (`settings.json` — none exist today) or a **single wrapper script / foundry tool**. Saving is per-invocation: `(N−1) context re-reads + narration output`, multiplied across every merge / session / worker.

| Current AI work | Where | Determinism | Proposed mechanism | Est. saving / invocation | Quality risk |
|---|---|---|---|---|---|
| **Twin ritual** `drain→backfill→reconcile→retro` | `policies/git.md`, CLAUDE.md; cmds already exist (`npm run dev -- …`, `ritual:post-merge`) | **High** — fixed command sequence; `ritual:post-merge` already bundles `reviews`+`resolve-findings` | `post-merge` git hook (or one `foundry_ritual` tool) that runs the sequence; AI only writes the PR body lines | ~5–7 tool calls + narration **per merge** (huge on autonomous drains) | **Low** — commands are deterministic; AI still authors `Producer:/Effort:/Effect:` |
| **PR body convention lines** (`Producer:`, `Effort:`, `Effect:`) | CLAUDE.md, `policies/git.md` | **High** for `Producer:` (session knows its own attribution); Medium for `Effect:` (a judgment) | `prepare-commit-msg`/PR template auto-fills `Producer:` + `Effort:`; AI fills only `Effect:` when it can defend it | small but every PR | **Low** |
| **workbench-doctor** briefing | `.claude/skills/workbench-doctor` | **High** — git branch/dirty/ahead-behind, manifest-vs-disk drift, stale-claim heuristic | Plain script emitting a JSON/markdown brief in one call (it's already declared read-only) | multi-step → 1 call per session start | **Low** — read-only |
| **gh-kanban-board-state** | skill | **High** — count issues per column, WIP-cap flag | `gh`+`jq` script, one call | multi-step → 1 | **Low** |
| **gh-wip-enforcer** | skill | **High** — count vs cap, allow/block | script returns boolean+reason | multi-step → 1 | **Low** |
| **gh-release-notes-builder** | skill | **High** — group merged PRs by type/label | script; AI only polishes prose | multi-step → 1 | **Low** |
| **spec-auditor** numbering/x-ref/frontmatter/markdownlint | agent + skill | **High** for the checks (numbering collisions, dangling links, lint); Low for "is this ADR coherent" | run the deterministic checks as a script/hook; reserve the agent for semantic judgment | a whole agent dispatch → 1 script call for the mechanical pass | **Low** — keep agent for semantic review |
| **gh-story-validator** | skill | **Mostly** — scoped/sized/criteria-present checklist | script for the presence checks; AI for the "is it actually ready" judgment | multi-step → 1 + small judgment | **Medium** — readiness is partly judgment |
| **green-desk** sweep+partition | skill | **High** for sweep + path-disjoint partition; Low for false-positive verdicts | scriptify the sweep/partition; keep AI for the audit-ledger FP calls | large multi-step → script + few judgments | **Medium** |

**Note — the foundry MCP already proves the pattern.** `foundry_claim / gate / queue / record_merge / dashboard` are *already* the deterministic-tool version of what used to be AI prose. The items above are the **remaining** AI-orchestrated rituals that haven't yet been pulled into a tool/hook. Framing for the plan tree: **extend the foundry tool surface (or add hooks) to absorb these**, the same way claim/gate/merge were absorbed.

---

## Tier 3 — On-demand & per-run-amplified (lower priority, but note the multipliers)

On-demand bodies cost nothing until read, so they're low priority — **except** when a loop re-reads them per iteration or per worker:

| Artifact | Size | Why it matters |
|---|---|---|
| `foundry-conduct/SKILL.md` | **40KB** (~10K tok) | Read by every conductor; superconductor spawns one per product → ×N |
| `foundry-superconduct/SKILL.md` | 21.5KB | Top-of-loop, read once but large |
| `foundry-worker/SKILL.md` | 17.7KB | Read by **every** worker session → biggest multiplier |
| `product-engine` / `md-quality-review` / `green-desk` / `new-domain` / `monitor-ci` | 18–22KB each | Re-read per invocation |

**Recommendation:** for the per-worker/per-conductor skills (`foundry-worker`, `foundry-conduct`), split into a lean **always-needed core** + a `references/` file loaded only on the branches that need it (the skill-authoring "progressive disclosure" pattern). A worker that doesn't hit the edge cases shouldn't pay for their instructions. Quality risk **Low** if the core retains the happy-path protocol.

Agent/skill **count** also matters: 23 agent descriptions + 48 skill one-liners are always-on lists. If any agents/skills are dead post-workbench-drop, removing them trims the lists. Defer until the drop.

---

## Redundancy findings (de-dup = free tokens)

1. **AGENTS.md ↔ CLAUDE.md** — 74/107 identical lines; AGENTS.md is a Codex-substituted clone. Generate it, don't hand-maintain it.
2. **Substrate-kernel doctrine** appears in: project `CLAUDE.md`, multiple ADRs, north-star, and several skill bodies. The CLAUDE.md copy should be the *minimal* statement (4 concerns + inclusion test) + citations; depth belongs in the cited specs, not re-narrated.
3. **Twin-ritual instructions** are spread across `CLAUDE.md` + `policies/git.md` with overlap. Consolidate to one canonical location, link from the other.
4. **Global CLAUDE.md** carries Maven + postch-auth blocks that never apply inside de-braighter — cross-project cost, not de-braighter-specific.

---

## Prioritized work-items (ready to claim in the plan tree)

Ordered by `(impact × certainty) / quality-risk`. Scopes are disjoint.

| # | Item | Scope (files) | Class | Est. impact | Risk |
|---|---|---|---|---|---|
| **W1** | **Fix + compact MEMORY.md under 24KB** | `…/memory/MEMORY.md` + topic files | Tier 1 | ~4K always-on + un-truncates recall | Low |
| **W2** | **Twin-ritual → `post-merge` hook / `foundry_ritual` tool** | `settings.json` hooks, `policies/git.md`, devloop scripts | Tier 2 | Biggest — kills ritual round-trips on every merge | Low |
| **W3** | **Trim 6 fattest agent descriptions** to trigger+boundary only | `.claude/agents/{substrate-coder-pro,windows-devops-pro,i18n-pro,swiss-pro,substrate-architect,fhir-pro}.md` | Tier 1 | ~2K always-on | Medium |
| **W4** | **Scriptify read-only briefings** (`workbench-doctor`, `gh-kanban-board-state`, `gh-wip-enforcer`) | those 3 skills + 3 scripts | Tier 2 | multi-step→1 each | Low |
| **W5** | **De-dup project CLAUDE.md** (substrate section + layout) | `CLAUDE.md` | Tier 1 | ~0.8K always-on | Low |
| **W6** | **Auto-fill PR `Producer:`/`Effort:` lines** via template/hook | PR template, `prepare-commit-msg` | Tier 2 | small × every PR | Low |
| **W7** | **Progressive-disclosure split** of `foundry-worker` + `foundry-conduct` (core + references/) | those 2 SKILL.md | Tier 3 | per-worker/conductor multiplier | Low |
| **W8** | **Generate AGENTS.md from CLAUDE.md** (kill hand-sync) | build step + AGENTS.md | redundancy | 0 tokens, −1 sync burden | Low |
| **W9** | **Scriptify spec-auditor mechanical pass** (numbering/x-ref/lint), keep agent for semantics | `spec-auditor` skill/agent + script | Tier 2 | agent dispatch → 1 script call | Low |

---

## Durable vs workbench-specific (you're about to drop the workbench)

**Durable — re-apply to whatever replaces the workbench:**
- The **cost model** (always-on / on-demand / per-run-amplified; scriptify > trim).
- **W1** MEMORY.md discipline (global memory, survives the drop).
- **W2 / W6** ritual + PR-line automation (lives in foundry tools/hooks, the thing you're keeping).
- **W7** progressive-disclosure skill splitting (foundry skills survive).
- The **redundancy principle** (state once + cite; don't re-narrate doctrine).

**Workbench-specific — may be mooted by the drop; don't invest until the new shape is known:**
- **W3 / W5** trimming the *current* CLAUDE.md / agent descriptions (these files may be regenerated/replaced).
- **W8** AGENTS.md (may not exist post-drop).
- Agent/skill **count** reduction (re-inventory after the drop).

**Suggested sequencing for the plan tree:** do the **durable** items first (W1, W2, W7, W6), because they pay off regardless of the workbench drop; defer the **workbench-specific** trims (W3, W5, W8) until the fusioned structure is settled, then re-run this audit's static layer against the new files.

---

## Reproduce this audit

- **Static:** byte counts per artifact ÷4 for tokens; extract agent `description:` frontmatter length (that, not the body, is the always-on cost).
- **Dynamic:** over `~/.claude/projects/<proj>/*.jsonl`, take first-turn `cache_creation+input` as the baseline, sum `cache_read` and `output` per session, hit% = `cache_read/(cache_read+output)`.
- Re-run after each batch of cuts to confirm the baseline actually dropped (the only ground truth that the trim landed).
