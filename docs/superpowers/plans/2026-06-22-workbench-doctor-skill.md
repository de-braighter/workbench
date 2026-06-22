# Workbench Doctor Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only `/workbench-doctor` skill that prints one start-of-session cluster briefing (manifest drift, sibling git status, foundry next + gates, owed-ritual heuristic).

**Architecture:** A single declarative skill at `.claude/skills/workbench-doctor/SKILL.md` — frontmatter + an ordered, read-only procedure the agent runs (four shell/MCP checks) then formats into one briefing. No code, no `package.json`, no mutation. The four check commands below are already verified against the live cluster; the implementer embeds them verbatim.

**Tech Stack:** Markdown skill; POSIX `sh`/Bash (`git`, `grep`, `sed`, `comm`, `awk`); read-only Foundry MCP tools.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-22-workbench-doctor-design.md` — every task implicitly includes its requirements.
- **Read-only invariant.** Allowed: Read/Glob/Grep, read-only Bash (`git status`/`log`/`rev-list`/`rev-parse`/`remote get-url`, `ls`, `grep`, `sed`, `comm`, `awk`), read-only Foundry MCP (`foundry_next`/`foundry_status`/`foundry_gate_status`). **Forbidden by name:** any write/commit/push; `git checkout`/`switch`/`stash`/`add`/`fetch`/`reset`; every mutating `foundry_*` tool.
- **Offline.** No network, no `gh`, no npm registry, no `git fetch`.
- **Execution placement.** The sibling repos under `layers/`/`domains/` are gitignored at the workbench root, so a git worktree of the workbench does NOT contain them. **Execution subagents must run in the main clone WITHOUT worktree isolation** — otherwise the cluster-reading commands have nothing to read.
- **Placement.** The skill is declarative content; it lives in the workbench repo at `.claude/skills/workbench-doctor/`. Do not add executable code anywhere.
- **Skill convention** (match existing skills, e.g. `.claude/skills/green-desk/SKILL.md`): YAML frontmatter with `name`, `description`, `tags`, then a markdown body.

---

### Task 1: Author `SKILL.md`

**Files:**
- Create: `.claude/skills/workbench-doctor/SKILL.md`

**Interfaces:**
- Consumes: nothing (leaf artifact).
- Produces: the `/workbench-doctor` skill — invoked by name; no programmatic callers.

- [ ] **Step 1: Create the skill directory + frontmatter**

Create `.claude/skills/workbench-doctor/SKILL.md` starting with:

```markdown
---
name: workbench-doctor
description: "Read-only start-of-session operational briefing for the de-braighter cluster — manifest-vs-disk drift, per-sibling git branch/dirty/ahead-behind, foundry next-item + pending founder gates + stale claims, and an owed-devloop-ritual heuristic. Use when the founder says 'workbench doctor', 'workbench wake', 'cluster health', 'where are we', 'what should I do next', or at the start of a session to orient. STRICTLY read-only: never writes, commits, switches branches, fetches, or calls a mutating foundry tool."
tags: [workbench, operations, health, orientation]
---
```

- [ ] **Step 2: Write the intro + read-only contract**

Add a body intro stating: this skill prints ONE briefing and is strictly read-only. Copy the **Read-only invariant** and **Offline** lines from Global Constraints verbatim as an explicit "Allowed / Forbidden" block, so the procedure cannot drift into mutation. Note the `stash`/`checkout` ban encodes the wave-agent-stashed-WIP incident: a briefing must never disturb a concurrent session's working tree.

- [ ] **Step 3: Embed Check 1 — manifest drift** (verified snippet)

````markdown
```bash
manifest=$(sed -n '/^  layers:/,/^[^ ]/p; /^  domains:/,/^[^ ]/p' repos.yaml | grep -oE '^    - [a-z0-9-]+' | sed 's/^    - //' | sort -u)
disk=$(for g in layers domains; do for d in "$g"/*/; do n=$(basename "$d"); [ -e "$d/.git" ] && echo "$n"; done; done | sort -u)
echo "unlisted on disk:"; comm -13 <(echo "$manifest") <(echo "$disk") | tr '\n' ' '; echo
echo "missing on disk:";  comm -23 <(echo "$manifest") <(echo "$disk") | tr '\n' ' '; echo
```
````

Instruction text: report counts (layers/domains in manifest) and the two drift lists; "none/none" ⇒ in sync.

- [ ] **Step 4: Embed Check 2 — sibling git status** (verified snippet)

````markdown
```bash
status_repo () { local r="$1" br dirty cnt ab
  br=$(git -C "$r" rev-parse --abbrev-ref HEAD 2>/dev/null); [ "$br" = "HEAD" ] && br="DETACHED"
  cnt=$(git -C "$r" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  dirty=$([ "$cnt" -gt 0 ] && echo "dirty($cnt)" || echo "clean")
  ab=$(git -C "$r" rev-list --left-right --count origin/main...HEAD 2>/dev/null | awk '{print $2"^ "$1"v"}')
  printf '  %-28s %-9s %-10s %s\n' "$r" "$br" "$dirty" "$ab"; }
status_repo "."
for g in layers domains; do for d in "$g"/*/; do status_repo "${d%/}"; done; done
```
````

Instruction text: flag (`WARN`) any non-`main` branch, dirty tree, or DETACHED HEAD.

- [ ] **Step 5: Embed Check 3 — foundry next + gates** (MCP, read-only)

Instruction text (no shell): call `foundry_next` for the top claimable item; call `foundry_status` (and/or `foundry_gate_status`) for pending founder gates + active/stale claims. Summarize: next item, gate count awaiting founder, stale-claim count. If the Foundry MCP is unavailable, print `Foundry: unavailable` and continue.

- [ ] **Step 6: Embed Check 4 — owed-ritual heuristic** (verified snippet)

````markdown
```bash
EV=domains/foundry/data/events.jsonl
owed_for () { local repo="$1" ref="$2" owed="" prs name
  name=$(basename -s .git "$(git -C "$repo" remote get-url origin 2>/dev/null)")
  prs=$(git -C "$repo" log --oneline -n 10 "$ref" 2>/dev/null | grep -oE '\(#[0-9]+\)' | grep -oE '[0-9]+' | sort -un)
  for n in $prs; do
    grep -qE "\"repo\":\"de-braighter/$name\",\"pr\":$n[,}]" "$EV" 2>/dev/null || owed="$owed #$n"
  done
  printf '  %-24s owed:%s\n' "$name" "${owed:- none}"; }
for r in . layers/*/ domains/*/; do owed_for "${r%/}" "origin/main"; done
```
````

Instruction text: this is a **heuristic** — `{recent merges on main} − {refs already in the foundry event log}`. Window is the last 10 merges per repo (session-recent scope; older un-ingested history is a backlog concern, not a session-start one). Accuracy depends on local refs being current; a stale clone under-reports. Label the output `owed (heuristic)`. If `events.jsonl` is absent, print `Rituals: event log unavailable`.

- [ ] **Step 7: Write the assembly + output-format section**

Instruct the agent to run Checks 1–4 in order and render ONE plaintext briefing in this shape (healthy lines terse; anomalies carry `WARN`):

```text
Workbench Doctor — <date>

Workbench:   branch <b> · <clean|dirty(n)> · <a>^ <b>v vs origin/main
Manifest:    repos.yaml <in sync|DRIFT> (<n> domains, <n> layers)
             unlisted on disk: <…|none>   missing on disk: <…|none>
Siblings:    <repo> <branch> <clean|dirty(n)>  [WARN <reason>]
Foundry:     next: <item> · gates pending: <n> · stale claims: <n>
Rituals:     owed (heuristic): <repo#pr …|none>
```

- [ ] **Step 8: Re-run every embedded block to confirm it still works**

From the workbench root, copy each fenced `bash` block out and run it. Expected (current ground truth): Check 1 ⇒ both lists empty; Check 2 ⇒ `domains/health` DETACHED, `.` dirty; Check 4 ⇒ `workbench owed: none`. If any block errors or contradicts ground truth, fix it in `SKILL.md` and re-run.

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/workbench-doctor/SKILL.md
git commit -m "feat(skill): add read-only /workbench-doctor briefing"
```

---

### Task 2: Acceptance — run the skill end-to-end against ground truth

**Files:** none created; this is a verification task.

**Interfaces:**
- Consumes: the `SKILL.md` from Task 1.

- [ ] **Step 1: Invoke the skill**

Run `/workbench-doctor` (follow the SKILL.md procedure top to bottom in the main clone).

- [ ] **Step 2: Assert against known ground truth**

Confirm ALL of:
- Manifest reads **in sync** (post-workbench#197).
- `domains/health` shows `DETACHED` with a `WARN`.
- The workbench root shows its dirty WIP.
- `workbench#197` does **not** appear under owed.
- Output is one briefing; no command mutated anything (re-run `git -C . status` and a sibling's `status` — unchanged).

- [ ] **Step 3: Prove the drift path fires (synthetic, read-only)**

Run the Check-1 snippet but grep `disk` for a name absent from the manifest (e.g. append a fake to a copy of the list in a subshell variable — do NOT edit `repos.yaml`). Confirm it would surface under "unlisted on disk". This proves the detection path without mutating the manifest.

- [ ] **Step 4: Commit any fix**

If Steps 2–3 surfaced a defect, fix `SKILL.md` and:

```bash
git add .claude/skills/workbench-doctor/SKILL.md
git commit -m "fix(skill): correct workbench-doctor <defect>"
```

If no fix was needed, no commit — proceed to the finishing step (open the PR bundling the spec + plan + skill for this slice).
