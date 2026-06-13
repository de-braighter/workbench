# Green-Desk Ledgers

Durable state for the `/green-desk` debt-path generator (autonomous-foundry
conductor **Component D** — `docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` §D).

The conductor itself holds **zero** durable state ("store generators, derive
graphs" — the foundry event log is the only authority for queue/claim state).
Green-desk's two ledgers are the conductor's *durable green-desk memory*: they
let repo-suppression and FP-suppression survive across sessions and machines,
without growing the foundry kernel (ADR-176 — repo-suppression has a single
consumer, so it is a tracked FILE, never a foundry event).

Both ledgers are **git-tracked**. That is what makes suppression durable: a
fresh `/green-desk` session on any machine reads the same `lastSweptCommit` and
the same FP rows.

## `ledger/<repo-slug>.json` — the per-repo sweep ledger

One file per swept repo, written by `/green-desk` step 10. Records what the last
sweep saw so the next sweep can suppress (HEAD unchanged → skip) and detect
stuck debt (no progress at an unchanged HEAD → surface, don't loop).

| Key | Type | Meaning |
| --- | --- | --- |
| `repo` | string | The foundry repo string, e.g. `de-braighter/exercir`. |
| `lastSweptCommit` | string | `git rev-parse origin/main` at the last sweep. **Suppression key** — if it equals the current HEAD, the repo is skipped (nothing merged since). |
| `lastSweptAt` | string (ISO) | Timestamp of the last sweep. |
| `lastOffenseCount` | int | Total real-offense count (after FP-drop) at the last sweep. The **no-progress** comparison baseline. |
| `consecutiveNoProgress` | int | Count of consecutive *genuine re-sweeps* (HEAD moved + prior items resolved) that emitted items without reducing the offense count. At `>= 2` the repo is **stopped** as stuck debt (step 3) — reachable independent of HEAD. |
| `pushPending` | bool | `true` only when a scan could not reach the foundry (the items were not emitted). While set, step 2 does **not** suppress on an unchanged HEAD, so the retry emits. Cleared on a successful push. |
| `dimensions` | object | Per-dimension offense counts, e.g. `{ "lint": 4, "knip": 2 }` — for the report + auditing. |
| `emittedItems` | string[] | The itemIds emitted by the last sweep (`green-desk-<repo-slug>/debt-<area>-<sha7>`, `<sha7>` = first 7 of the swept HEAD — makes each sweep's ids unique). |
| `green` | bool | True when the last sweep found 0 real debt (coverage ≥ 80%, mutation ≥ floor). |

The keys here are the exact schema written by the skill (Task 1 step 10) and
read back by suppression (step 2), the no-new-progress guard (step 3), and the
no-progress signal (step 8).

## `fp-ledger.md` — the false-positive audit ledger

A single append-only markdown table of **verified** false-positive suppressions.
A green-desk dimension reaches 0 only when its real offenses are fixed; a
verified FP is suppressed with justification so the dimension can genuinely
reach 0 **without** chasing noise. The rule is **native ignore + ledger row,
never silent**:

1. add the **native per-tool ignore** (knip config, an `eslint-disable` with a
   reason, a Sonar issue-resolution, etc.) so the tool itself stops reporting it;
2. append a row here so the suppression is auditable.

`/green-desk` step 5 reads this table and drops any matching offense (by `tool` +
`path` + `rule`) before partitioning — so a suppressed FP is **never re-emitted**.
It ships with only the header row (so a cold first sweep always finds the file);
workers append verified suppressions below it.

| Column | Meaning |
| --- | --- |
| `date` | When the suppression was recorded (ISO date). |
| `repo` | The repo the FP is in. |
| `tool` | The dimension/tool, e.g. `knip`, `eslint`, `sonar`. |
| `path` | The offending file path. |
| `rule` | The specific rule/code suppressed (e.g. knip `declaration-emit-types`). |
| `justification` | Why it is a true false-positive (the F5 runbook class, etc.). |
| `reviewer` | Who verified it (the suppression is reviewed, not unilateral). |

Row form: `| date | repo | tool | path | rule | justification | reviewer |`.

## `ledger/.gitkeep`

`ledger/` fills at **sweep time** — the per-repo JSON files are written by
`/green-desk` when it sweeps a repo, not by this PR. A `.gitkeep` keeps the empty
directory in git so the first sweep has a tracked home to write into. (This README,
the header-only `fp-ledger.md`, and the `.gitkeep` are part of the skill PR; the
per-repo ledger DATA files appear as sweeps run.)
