---
name: workbench-doctor
description: "Read-only start-of-session operational briefing for the de-braighter cluster — manifest-vs-disk drift, per-sibling git branch/dirty/ahead-behind, foundry next-item + pending founder gates + stale claims, and an owed-devloop-ritual heuristic. Use when the founder says 'workbench doctor', 'workbench wake', 'cluster health', 'where are we', 'what should I do next', or at the start of a session to orient. STRICTLY read-only: never writes, commits, switches branches, fetches, or calls a mutating foundry tool."
tags: [workbench, operations, health, orientation]
---

# Read-Only Operational Briefing

This skill prints a single briefing on cluster health: manifest-vs-disk drift, per-sibling git status, foundry queue state, and owed devloop rituals. It is **strictly read-only** and cannot modify any repository state.

## Read-Only Invariant

**Allowed:**
- Read `repos.yaml`, `.git/` refs, `domains/foundry/data/events.jsonl`
- Call `foundry_next`, `foundry_status`, `foundry_gate_status` (read-only MCP queries only)
- Print briefing to stdout

**Forbidden:**
- Write to any repository
- Commit, push, fetch, or pull
- Switch branches, stash, or restore working-tree files
- Call any mutating foundry tool (e.g., `foundry_conduct`, `foundry_authorize`)
- Disturb a concurrent session's working tree

The `stash`/`checkout` ban encodes the wave-agent-stashed-WIP incident: a briefing must never disturb concurrent session work.

## Offline

This skill operates **entirely on local state** — no network calls except to the Foundry MCP (which must be available locally). No `git fetch`, no GitHub API, no remote query.

---

## Check 1: Manifest vs. Disk

Run this to detect drift between `repos.yaml` and actual clones under `layers/` and `domains/`:

```bash
manifest=$(sed -n '/^  layers:/,/^[^ ]/p; /^  domains:/,/^[^ ]/p' repos.yaml | grep -oE '^    - [a-z0-9-]+' | sed 's/^    - //' | sort -u)
disk=$(for g in layers domains; do for d in "$g"/*/; do n=$(basename "$d"); [ -e "$d/.git" ] && echo "$n"; done; done | sort -u)
echo "unlisted on disk:"; comm -13 <(echo "$manifest") <(echo "$disk") | tr '\n' ' '; echo
echo "missing on disk:";  comm -23 <(echo "$manifest") <(echo "$disk") | tr '\n' ' '; echo
```

**Report:** list counts (number of layers and domains in manifest) and the two drift lists. "none/none" ⇒ in sync. Example output:
```
unlisted on disk: none
missing on disk: none
```

---

## Check 2: Sibling Git Status

Run this to inspect branch, dirty-file count, and ahead/behind per repo:

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

**Report:** list each repo with its branch, dirty-file count, and ahead/behind versus `origin/main`. Flag (`WARN`) any non-`main` branch, dirty tree, or DETACHED HEAD. Example healthy output:
```
  .                            main       clean      0^ 0v
  layers/substrate             main       clean      0^ 0v
  layers/design-system         main       clean      0^ 0v
  …
```

---

## Check 3: Foundry Queue & Pending Gates

Call the Foundry MCP (read-only queries only):

1. `foundry_next` — return the top claimable item (or `none` if queue is empty or all items claimed).
2. `foundry_status` or `foundry_gate_status` — return the count of pending founder gates and the count of stale claims.

**Report:** next item, gate count awaiting founder, stale-claim count. If the Foundry MCP is unavailable, print `Foundry: unavailable` and continue without error.

Example output:
```
Foundry: next: foundry #42 (build-path M-2) · gates pending: 3 · stale claims: 0
```

---

## Check 4: Owed Devloop Ritual

Run this to detect merged PRs on `origin/main` not yet recorded in the foundry event log (a heuristic for owed post-merge rituals):

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

**Report:** this is a **heuristic** — `{recent merges on origin/main} − {refs already in the foundry event log}`. Window is the last 10 merges per repo (session-recent scope; older un-ingested history is a backlog concern, not a session-start one). Accuracy depends on local refs being current; a stale clone under-reports. Label the output `owed (heuristic)`. If `events.jsonl` is absent, print `Rituals: event log unavailable`.

Example output:
```
  workbench            owed: none
  substrate            owed: none
  design-system        owed: none
  …
  foundry              owed: #42 #41
```

---

## Assembly & Output Format

Run Checks 1–4 in order and render ONE plaintext briefing (healthy lines terse; anomalies carry `WARN`):

```
Workbench Doctor — <date>

Workbench:   branch <b> · <clean|dirty(n)> · <a>^ <b>v vs origin/main
Manifest:    repos.yaml <in sync|DRIFT> (<n> domains, <n> layers)
             unlisted on disk: <…|none>   missing on disk: <…|none>
Siblings:    <repo> <branch> <clean|dirty(n)>  [WARN <reason>]
Foundry:     next: <item> · gates pending: <n> · stale claims: <n>
Rituals:     owed (heuristic): <repo#pr …|none>
```

Example:
```
Workbench Doctor — 2026-06-22

Workbench:   branch main · clean · 0^ 0v vs origin/main
Manifest:    repos.yaml in sync (11 domains, 5 layers)
             unlisted on disk: none   missing on disk: none
Siblings:    domains/health DETACHED dirty(3)  [WARN: DETACHED HEAD]
Foundry:     next: foundry #42 (build-path M-2) · gates pending: 2 · stale claims: 0
Rituals:     owed (heuristic): foundry #40 #39
```

---
