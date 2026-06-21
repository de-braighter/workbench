# Workbench Doctor — design spec

- **Date:** 2026-06-22
- **Status:** approved (brainstorming → writing-plans)
- **Origin:** `docs/workbench-improvement-handover-2026-06-21.md` (Recommended First Slice)
- **Slice:** read-only operational briefing for the de-braighter cluster.

## Problem

Every session that starts from the workbench root re-derives "where are we?"
by hand: which sibling repos are dirty or off `main`, whether `repos.yaml`
matches disk, what the Foundry queue wants next, which merges still owe the
SDLC-twin ritual. The information already exists — it is just scattered across
git, the filesystem, the Foundry MCP, and the devloop event log, with nothing
surfacing it at a glance. The drift this invites is real: at design time
`repos.yaml` had silently fallen four domains behind disk (fixed in
workbench#197), including `foundry`, the meta-product control plane.

## Goal

A single `/workbench-doctor` skill that prints one read-only operational
briefing, replacing manual start-of-session exploration. Boring, read-only,
immediately useful. It detects drift; it never fixes it.

## Non-goals (v1)

- No mutation of any kind — no writes, commits, branch switches, or fetches.
- No version matrix, PR-body composer, or mechanized PR-metadata gates
  (handover themes #4–#6 — later slices).
- No network: no `gh`, no npm registry, no `git fetch`. (A `--deep` online
  mode is named as a future extension, not built here.)
- No standalone executable / no `package.json` in the workbench (the workbench
  is declarative content only; this ships as a skill).

## Architecture

One artifact: `.claude/skills/workbench-doctor/SKILL.md`. No code, no other
files. The body is a fixed, ordered, read-only procedure the agent executes,
then formats into one briefing.

- **Frontmatter:** `name: workbench-doctor`; `tags: [workbench, operations,
  health, orientation]`; a `description` that triggers on "workbench doctor",
  "workbench wake", "cluster health", "where are we", "what should I do next",
  and session-start orientation.
- **Invocation:** `/workbench-doctor`.
- **Placement rationale:** a skill *is* declarative content (markdown +
  permitted read-only shell), so it respects the workbench "no code, declarative
  only" rule with zero tension — unlike a script, which would force the awkward
  "code belongs in a sibling repo" detour. If determinism/testability later
  justifies it, the heuristic promotes cleanly into a `devloop doctor` command
  and the skill simply calls it (an evolution, not a rewrite).

## The four checks

Each check is independent and degrades alone: a missing source renders that
section as `unavailable` / `n/a`; the briefing never aborts on one failure.

### Check 1 — Manifest drift (offline, deterministic)

Extract `layers/*` and `domains/*` names from `repos.yaml` with `grep`/`sed`
(no python or yaml-lib dependency — the manifest is a flat `- name # comment`
list). Diff against the actual git-repo directories on disk under `layers/`
and `domains/`. Report, per group:

- **missing-on-disk** — listed in `repos.yaml`, absent on disk.
- **unlisted-on-disk** — present on disk as a git repo, absent from `repos.yaml`.

### Check 2 — Sibling git status (offline)

For the workbench root plus every repo under `layers/` and `domains/`:

- branch — `git -C <repo> rev-parse --abbrev-ref HEAD`;
- dirty — `git -C <repo> status --porcelain` (non-empty ⇒ dirty, with a count);
- ahead/behind vs `origin/main` from **local refs only** —
  `git -C <repo> rev-list --left-right --count origin/main...HEAD` (no fetch).

Flag non-`main` branches, dirty trees, and detached HEAD.

### Check 3 — Foundry next + gates (local MCP, 127.0.0.1)

Call the read-only Foundry MCP tools: `foundry_next` (top claimable item) and
`foundry_status` / `foundry_gate_status` (pending founder gates, active and
stale claims). Summarize the next item and any gate awaiting the founder.

### Check 4 — Owed rituals (offline heuristic, labelled)

Per repo: take the last ~20 `origin/main` commit subjects, extract `(#NNN)`
PR references from squash-merge commits, and subtract the PR references already
present in the Foundry event log (`domains/foundry/data/events.jsonl`, where
`backfill` writes). The remainder = merges the twin has not ingested ⇒ ritual
owed.

Stated as a heuristic with its assumption visible: accuracy depends on local
refs being current; a stale clone under-reports merges. (A future `--deep`
mode would fetch first.)

## Output format

Plaintext, scannable, in the handover's shape. Healthy lines stay terse; only
anomalies carry a `⚠`.

```text
Workbench Doctor — 2026-06-22

Workbench:   branch main · dirty (N files) · 0 ahead / 0 behind
Manifest:    repos.yaml ✓ in sync (12 domains, 5 layers)
             unlisted on disk: none   missing on disk: none
Siblings:    layers/substrate   main      clean
             domains/health     DETACHED  clean   ⚠ detached HEAD
             domains/foundry    main      dirty (3)
Foundry:     next: <item>  ·  gates pending: <n>  ·  stale claims: <n>
Rituals:     owed (heuristic): exercir#314, studio#28   ·  else clean
```

## Guardrails (read-only invariant)

Named explicitly in the skill so the procedure cannot drift into mutation:

- **Allowed:** Read / Glob / Grep; read-only Bash (`git status` / `log` /
  `rev-list` / `rev-parse`, `ls`, `grep`, `sed`); read-only Foundry MCP
  (`foundry_next` / `foundry_status` / `foundry_gate_status`).
- **Forbidden, by name:** any write / commit / push; `git checkout` /
  `switch` / `stash` / `add` / `fetch` / `reset`; and every mutating
  `foundry_*` tool. The `stash` / `checkout` ban encodes the wave-agent
  incident (a read-only briefing must never disturb a concurrent session's
  working tree).
- **Offline:** no network, no `gh`, no npm registry, no `fetch`.

## Verification

A skill has no unit tests; acceptance is by observation against known ground
truth, run once in-session:

- Manifest reads **in sync** (post-workbench#197).
- A repo known to be on a detached HEAD shows `⚠ detached HEAD`.
- The workbench shows its dirty WIP.
- workbench#197 does **not** appear as owed (it was reconciled at design time).
- A throwaway grep for a name absent from `repos.yaml` confirms the
  drift-detection path fires.

The handover success criterion — "detects at least one real class of drift" —
is met by Check 1 by construction.

## Future extensions (not v1)

- `--deep`: `git fetch` + `gh pr list` for freshness beyond local refs.
- Promote Check 4's heuristic into a deterministic, unit-tested
  `devloop doctor` subcommand; the skill calls it.
- Add the version matrix, PR-body composer, and mechanized PR-metadata gates as
  their own slices.
