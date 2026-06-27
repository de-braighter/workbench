---
name: green-desk
description: "Foundry debt-path generator (autonomous-conductor Component D) — sweep one repo (or --all) across every quality dimension, drop verified false-positives via the audit ledger, partition the offending files into PATH-DISJOINT area items (green-desk-<repo-slug>/debt-<area>), and push them to the foundry queue under a synthetic green-desk-<repo-slug> T0 product (low priority, so product work always outranks debt). Repo-suppression is git-HEAD-derived (a sweep ledger records lastSweptCommit; a repo is re-swept only after origin/main moves). Use when the founder says 'green-desk <repo>', 'green-desk --all', 'sweep the desk', 'drive <repo> green', or 'scan for debt', AND when the conductor's tier-2 pipeline-filler needs a debt work source."
tags: [foundry, green-desk, maintenance, pipeline]
---

# Green-Desk (Foundry Component D — debt-path generator)

This is **Component D** of the autonomous-foundry conductor design
(`docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` §D).
It is a **generator**, exactly analogous to `/build-path` but for tech debt: it
*emits cleanup work items*; it does **not** fix debt itself. Workers fix debt —
they claim each emitted item via the normal foundry-worker protocol and route
through the `/tech-debt` skill + the quality floor.

It is the **structural counterweight to per-PR nit-deferral**. Product PRs stay
fast by deferring `nit`/`note` for velocity; this sweep guarantees the deferred
nits never accumulate. **A ratchet, not a gate** — it never blocks a product PR;
it asynchronously drives every repo back to a fully-green desk between product work.

## The load-bearing constraints (design against EXACTLY these)

Two facts about the foundry kernel force this skill's shape. Both are verified
source, not convention:

1. **`toNextItem` (`domains/foundry/src/ops.ts`) reads `repo`, `riskTier`, and
   `priority` from the PRODUCT, not the item scope.** A single green-desk product
   spanning many repos would mislabel every item's `repo` to `foundry_next` and
   to the worker that claims it. → **one synthetic `green-desk-<repo-slug>`
   product per swept repo**, each carrying that repo. Never one product across
   many repos.
2. **`scopesDisjoint` (`domains/foundry/src/state.ts`)** treats two same-repo
   scopes as disjoint iff BOTH carry `pathPrefix` and (trailing-`/` normalized)
   neither prefix is a prefix of the other (`!pa.startsWith(pb) && !pb.startsWith(pa)`).
   Lint, knip, and `tsc` over the *same* files are NOT path-disjoint. →
   **partition by path-AREA, one `debt-<area>` item per area fixing ALL
   dimensions present in that area** — never one item per dimension (those would
   overlap on path and could never hold claims in parallel).

And one governance fact:

3. **ADR-176 kernel minimality.** Repo-suppression has exactly ONE consumer
   (this skill). A new `GreenDeskSwept` foundry event would fail the inclusion
   test (needs ≥2 packs). → **suppression is derived from `git rev-parse
   origin/main` compared to a `lastSweptCommit` recorded in a ledger FILE**
   (`docs/foundry/green-desk/ledger/<repo-slug>.json`). The foundry kernel does
   not grow for green-desk.

4. **The conductor owns the *wiring*; this skill owns the *mechanism*.**
   `/foundry-conduct` documents the anti-livelock rules (repo-suppression +
   per-cycle cap + no-new-progress stop) and *points at* this skill. The
   algorithm lives HERE; do not let it drift into two places.

## Green-desk target

A repo is **green** when a fresh scan (off a clean `origin/main` checkout) shows
the best-possible value on every dimension (spec §D.1):

- **Drive to 0:** lint (the repo's audit set), knip (dead code / unused exports /
  unused deps), `tsc` type errors, Sonar bugs / vulnerabilities /
  security-hotspots / code-smells / duplications / cognitive-complexity
  violations, **every open verifier finding including `nit`/`note`** (from the
  devloop twin), and TODO/FIXME/HACK debt markers.
- **Coverage** — the one higher-is-better metric: floor **80%**, target **90%**
  (never driven to 0).
- **Mutation** — coverage-like: at/above the tier floor, prefer higher (no
  separate hard target).
- **False positives are SUPPRESSED-WITH-JUSTIFICATION, not chased.** A verified
  FP gets BOTH (a) a native per-tool ignore so the dimension genuinely reaches 0,
  AND (b) an audit-ledger entry in `fp-ledger.md`. Never a silent ignore; never
  an infinite fix-loop.

## Procedure

1. **Resolve targets.** `--all` → enumerate the cluster repos **from the
   filesystem**, but only the **real clone roots**: a `domains/<name>/` or
   `layers/<name>/` directory (or the workbench root) is a target iff it contains
   a **`.git` _directory_** AND its `origin` remote is a `de-braighter/*` repo
   (`git -C <dir> remote get-url origin`). This **excludes** the orphaned
   worktree/scratch siblings that litter the cluster (`domains/<name>-wt-*`,
   `layers/<name>-wt-*`, `*-ws*`, `*-prepush-wt`, etc.): a git **worktree** has a
   `.git` _file_ (not a directory) and a scratch dir has no `.git` at all, so
   both are skipped. The resulting `repo` strings are `de-braighter/<name>` and
   `de-braighter/workbench`. **Do NOT read targets from `foundry_status`** — its
   board (`status.ts`) prints `productKey [riskTier] prio= stage=` but **no
   `repo`**, so it cannot enumerate the repo set. A named repo → just that one. The **`<repo-slug>`** used in every product key + itemId is the repo's
   short name: `de-braighter/<name>` → `<name>` (`de-braighter/exercir` →
   `exercir`); `de-braighter/workbench` → `workbench`. Map a `repo` to its
   filesystem path: `de-braighter/<name>` → `domains/<name>/` or
   `layers/<name>/` (whichever exists); `de-braighter/workbench` → the cluster
   root. (You may intersect with `foundry_status` product KEYS to prioritise
   repos with active foundry work, but the repo SET comes from the filesystem.)
2. **Repo-suppression check (per repo).** Read
   `docs/foundry/green-desk/ledger/<repo-slug>.json`. Compute
   `HEAD = git rev-parse origin/main` for that repo. **SKIP** this repo (emit
   nothing) when EITHER:
   - `ledger.lastSweptCommit === HEAD` **and** `ledger.pushPending` is not set —
     nothing merged since the last sweep, so the same state would re-emit; or
   - the previous sweep's emitted items are still **in flight** — the repo's
     `green-desk-<repo-slug>` product still shows a non-`done` count
     (queued + claimed + built > 0) on the `foundry_status` board. Re-sweeping
     before the prior cleanup lands would falsely read as no-progress (step 8);
     wait for them to resolve.

   `--force` bypasses both skips. **If `ledger.pushPending` is set** (a prior
   sweep scanned but could not reach the foundry), do NOT suppress on an
   unchanged HEAD — retry the emit. This is the conductor's "suppressed per repo
   until a merge changes it", made machine-checkable by git rather than by a
   foundry event.
3. **No-new-progress guard.** If `ledger.consecutiveNoProgress >= 2` →
   **STOP for this repo** and surface "stuck debt": across ≥2 genuine re-sweeps
   the offense count did not drop (the remaining offenses likely need FP-ledger
   entries or a founder decision — they are not closing). Do **not** emit; do
   **not** loop. The counter is incremented in step 8 on each *genuine* re-sweep
   (step 2 admits a re-sweep only when HEAD moved AND the prior items resolved),
   so this guard is **reachable independent of HEAD**. This is the
   no-new-progress stop the conductor relies on.
4. **Scan all dimensions** off a clean `origin/main` checkout/worktree:
   - lint — the repo's audit set (`npm run lint` / the repo's lint target);
   - `npx knip` — dead code / unused exports / unused deps;
   - `tsc --noEmit` — type errors;
   - coverage — `ci:local` / `test:coverage` (the higher-is-better dimension);
   - Sonar — read `localhost:9000` where wired (bugs / vulns / hotspots /
     smells / duplications / complexity);
   - mutation — where wired;
   - debt markers — `grep -rn 'TODO\|FIXME\|HACK'`;
   - the twin's unresolved findings — `npm run dev -- findings <repo>` from
     `domains/devloop`, **including `nit`/`note`** — **ADVISORY ONLY**: this
     command is a per-verifier × severity + *precision* readout (a calibration
     metric), **NOT a per-offense list with file paths**, and its counts are
     CUMULATIVE across the repo's PRs — a finding recorded on a PR whose
     should-fix was already fixed *in that PR* still shows here (fix-commit
     linkage is best-effort; precision under-counts addressed findings). So
     **never path-partition or emit a `debt-<area>` item from this dimension** —
     it has no paths and would re-emit already-fixed work. Use it only as an
     advisory signal: a verifier with many genuinely-unresolved findings
     (open on current `origin/main`, not addressed-in-PR) flags "investigate" —
     the worker inspects those findings and, if a concrete open offense with a
     real path is confirmed, it surfaces under the path-bearing dimension that
     owns it (lint / knip / tsc / Sonar / coverage / mutation / markers).
     Emittable area-scoped offenses come ONLY from the path-bearing dimensions above.

   Collect every PATH-BEARING offense as `{ dimension, path, detail }` (lint /
   knip / tsc / Sonar / coverage / mutation / markers — the partitionable
   dimensions). A repo with no Sonar/mutation/lint/knip wired: scan the
   dimensions that ARE wired and **note the unscanned ones in the report —
   never fabricate a `0`** for an unscanned dimension (an unwired tool is
   "unscanned", not "green").
5. **Drop false positives.** Read `docs/foundry/green-desk/fp-ledger.md`; drop
   any offense matching a suppression row (by `tool` + `path` + `rule`). These
   are not real debt and must never be re-emitted. (The ledger ships with only a
   header row; if it is ever absent — e.g. removed — treat it as empty, no
   suppressions, and continue.)
6. **Green check.** If, after the FP-drop, every dimension is at target (0 real
   debt + coverage ≥ 80% + mutation ≥ floor) → the repo is **GREEN**: record the
   sweep (`green: true`, reset `consecutiveNoProgress` to 0), emit NOTHING,
   report green. Else continue.
7. **Partition by path-area.** Group the offending `path`s into
   **path-disjoint** top-level areas at natural module/dir boundaries
   (`libs/<x>`, `apps/<x>`, `src/<x>`, `tools/<x>`). Each area → one
   `debt-<area>` item covering **ALL dimensions** with offenses in that area.
   Repo-global offenses (root config, cross-area duplication) → a single
   `debt-root` item; an area-item that would touch root files `dependsOn` it
   (usually none do — keep `dependsOn` minimal).
   **Verify the partition is path-disjoint** before emitting: enumerate every
   area pair and confirm neither pathPrefix (trailing-`/` normalized) is a
   prefix of the other — the *exact* `scopesDisjoint` test, the same proof
   `/build-path` step 8 runs. Any pair that fails → re-cut the areas tighter
   (or fold both under one item). Naturally distinct top-level dirs
   (`libs/a` vs `libs/b`) pass trivially; a parent/child pair (`libs` vs
   `libs/a`) does NOT — never emit both.
8. **Compute the no-progress signal.** This runs only on a *genuine re-sweep*
   (step 2 admitted it: HEAD moved AND the prior sweep's items resolved).
   Compare this scan's total real-offense count to `ledger.lastOffenseCount`. If
   the previous sweep emitted items and the count did **not** drop → increment
   `consecutiveNoProgress` (step 3 stops the repo at `>= 2`); else reset to 0.
9. **Register + push.** The synthetic product (rule 1 — carries THE repo):

   ```
   foundry_queue_push {
     product: {
       productKey: 'green-desk-<repo-slug>',
       name: 'Green-desk — <repo>',
       repo: 'de-braighter/<name>',
       riskTier: 'T0',
       priority: 200,        // HIGHER number = LOWER precedence (claimableItems sorts ascending); 200 keeps debt behind default-100 product work
       stage: 'maintenance'
     },
     items: [ ...debt items... ]
   }
   ```

   Registration is idempotent (write-once via the MCP surface) — for an
   already-registered green-desk product the product block is ignored. Each item:

   ```
   {
     itemId: 'green-desk-<repo-slug>/debt-<area>-<sha7>',   // sha7 = first 7 of the swept HEAD
     title: '<dimensions> in <area> — <N> offenses (e.g. lint×4, knip×2, smell×1);
              drive each named dimension to 0 at <a few exact locations>',  // self-contained acceptance bar for a cold worker
     scope: { repo: 'de-braighter/<name>', pathPrefix: '<area>' },
     qualityObligations: [ <the repo's floor obligations> ],
     dependsOn: ['green-desk-<repo-slug>/debt-root-<sha7>']   // ONLY if it touches root
   }
   ```

   **The `-<sha7>` suffix makes every sweep's itemIds unique**, so a re-push is
   never an already-queued collision (a prior cycle's items keep their own sha,
   and a same-HEAD double-emit is already blocked by the step-2 suppression).
   The dedup is therefore **structural**, not a `foundry_status` pre-check — the
   board shows per-product item *counts* plus only the top-N claimable/active/built
   itemIds, never a product's full queued itemId set. The title names the
   acceptance bar itself ("drive each named dimension to 0"), so no separate
   obligation token is needed. **Cap at the per-cycle item cap (default 10)**;
   yield the rest to the next cycle (the next sweep emits them once HEAD moves or
   `--force` is passed).
10. **Record the sweep** in `docs/foundry/green-desk/ledger/<repo-slug>.json`:

    ```json
    {
      "repo": "de-braighter/<name>",
      "lastSweptCommit": "<HEAD sha>",
      "lastSweptAt": "<ISO timestamp>",
      "lastOffenseCount": <int>,
      "consecutiveNoProgress": <int>,
      "pushPending": <bool>,
      "dimensions": { "lint": <n>, "knip": <n>, "...": <n> },
      "emittedItems": ["green-desk-<repo-slug>/debt-<area>-<sha7>", "..."],
      "green": <bool>
    }
    ```

    `pushPending` is `true` only when a scan could not reach the foundry (the
    items were not emitted); step 2 does not suppress while it is set. Clear it
    once the push succeeds.

    These keys match the schema documented in
    `docs/foundry/green-desk/README.md`. The ledger is git-tracked so suppression
    survives across sessions and machines.
11. **Report** the per-repo verdict (green / N items emitted / suppressed-no-change
    / stuck-debt) and, for `--all`, the roll-up across repos + the queue refs.

## Worker routing

A `debt-<area>` item is a **normal foundry T0 item**. The standard foundry-worker
protocol owns it end-to-end — atomic claim → worktree isolation → execute → wave →
land → release, **including the branch, the PR, and the merge**. In Phase-3
EXECUTE the worker fixes the offenses the item's title names, **directly under
the quality floor**, with the **diff confined to the area `pathPrefix`**:

- lint `--fix`, `tsc` errors, Sonar smells, dead exports/files (knip),
  cognitive-complexity (via `/clean-decompose-optimizer`), TODO/FIXME resolution.
- `/tech-debt`'s **detection/fix LOGIC** is a *reference* for the scopes it
  covers (dead-code → knip; token-cleanup → tokens) — borrow its technique, but
  do **NOT** run its branch/commit/PR mechanics: `/tech-debt` cuts its own
  branch and `git add -A`s the whole tree, which would break the foundry
  worktree branch and scope confinement. Stay on `feat/<slug>`; `git add` only
  paths under the area `pathPrefix`. `/tech-debt` also expects a per-repo
  `.Codex/sdlc.json` that may be absent — so it is **optional convenience,
  never a hard dependency**; the item's self-contained title (exact dimensions +
  locations) is the authority a cold worker fixes from.

A T0 green wave → squash-merge → twin ritual.

## FP suppression (the audit ledger)

When an offense is a verified false positive (e.g. knip's
declaration-emit-types / prisma-generate-dep classes per the F5 runbook), the
worker (or founder) does BOTH:

1. adds the **native per-tool ignore** so the dimension genuinely reaches 0
   (knip config, eslint-disable with a reason, Sonar issue-resolution, etc.);
2. appends an audit row to `docs/foundry/green-desk/fp-ledger.md`:
   `| date | repo | tool | path | rule | justification | reviewer |`.

Step 5 reads this ledger so a suppressed offense is **never re-emitted**. Never a
silent ignore — every suppression is auditable.

## Bounds (anti-livelock)

Three mechanisms, all owned here (the conductor points at them, never duplicates them):

- **Repo-suppression** (step 2) — git HEAD vs `lastSweptCommit`: a clean (or
  unchanged) repo is never re-swept.
- **Per-cycle cap** (step 9, default 10) — bounds token burn on pure debt; the
  overflow yields to the next cycle.
- **No-new-progress stop** (steps 3 + 8) — after 2 consecutive *genuine
  re-sweeps* (HEAD moved + prior items resolved) with no offense reduction, the
  repo's debt is surfaced as "stuck" rather than looped.

Together: a clean repo is never re-swept, the cap prevents unbounded burn, and
stuck debt surfaces instead of spinning.

## Cadence (spec §D.5)

- **Primary** — the conductor's autonomous IDLE tier-2 (`/foundry-conduct`):
  event-driven, suppression-bounded. This is the main path.
- **On-demand** — `/green-desk <repo>` (or `--all`) run by the founder directly.
- **Scheduled** — a weekly / after-N-merges cadence via a thin `CronCreate`
  routine that invokes a green-desk-mode coordinator. This is the explicit-cadence
  *wrapper*, not core — the suppression bounds make a clean repo a no-op even if
  the schedule fires.

## Failure stances

- **Foundry MCP unavailable** → scan and write the ledger anyway (it's
  diagnostic), but set `pushPending: true` (step 2 does not suppress on an
  unchanged HEAD while it is set), so the un-pushed items are emitted on the next
  reachable attempt. Clear `pushPending` once the push succeeds. Never simulate a
  push.
- **`queue_push` rejects an itemId as already queued** → with the `-<sha7>`
  suffix this should not occur across sweeps; if it does (e.g. a re-run at the
  same HEAD that slipped past suppression), diff against the ledger's
  `emittedItems` and push only the missing items — never re-push an id in flight.
- **A repo has no Sonar / mutation wired** → scan the dimensions that ARE wired;
  note the unscanned dimensions in the report. Do **not** fabricate a `0` for an
  unscanned dimension (that would falsely report green).

## Output

Per repo: `{ repo, verdict, itemsEmitted, suppressedDims, stuckDebt }` plus the
queue refs (the pushed itemIds). For `--all`: the per-repo blocks + a roll-up
(repos green / repos with items emitted / repos suppressed-no-change / repos with
stuck debt).
