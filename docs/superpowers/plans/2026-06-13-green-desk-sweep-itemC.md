# Green-Desk Sweep (Item C / spec Component D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/green-desk` debt-path generator skill and wire it as the autonomous conductor's tier-2 filler (replacing the abstract "Component D" stub), so the machine drives every repo to a fully-green desk between product work — a ratchet, not a gate.

**Architecture:** A declarative skill (analogous to `/build-path`, but for tech debt) that scans a repo's quality dimensions, drops false positives via an audit ledger, partitions the offending files into **path-disjoint area items** (`green-desk-<repo>/debt-<area>`), and pushes them to the foundry queue under a **synthetic `green-desk-<repo>` product (T0, low priority)** so product work always outranks debt. Repo-suppression is **git-HEAD-derived** (a sweep ledger records `lastSweptCommit`; a repo is re-swept only after its `origin/main` moves) — zero new foundry events (ADR-176: a single consumer fails the kernel inclusion test). Cleanup workers route through the existing `/tech-debt` skill + the quality floor. Loop-until-green is bounded by a per-cycle cap + a no-new-progress stop.

**Tech Stack:** Markdown skill authoring (`.claude/skills/`), the foundry MCP (`foundry_queue_push`, `foundry_status`), git plumbing (`git rev-parse origin/main`), the devloop twin findings CLI, Sonar (localhost:9000). No TypeScript — workbench-only, declarative.

---

## Why this shape (the load-bearing constraints)

- **`ops.ts:262` (`toNextItem`) reads `repo`/`riskTier`/`priority` from the PRODUCT, not the item scope.** A single green-desk product spanning many repos would mislabel every item's repo to `foundry_next`/the worker. → **one synthetic `green-desk-<repo>` product per swept repo.**
- **`state.ts:317` (`scopesDisjoint`) — two same-repo scopes are disjoint only when neither `pathPrefix` is a prefix of the other.** Lint/knip/tsc over the same files are NOT path-disjoint. → **partition by path-area, one item per area fixing all dimensions present there**, never one item per dimension.
- **ADR-176 minimality** — repo-suppression has exactly one consumer (green-desk). A new `GreenDeskSwept` foundry event would fail the inclusion test (≥2 packs). → **derive suppression from `git rev-parse origin/main` vs a ledger file**; the foundry kernel does not grow.
- **The conductor already documents the anti-livelock rules** (repo-suppression + per-cycle cap) in `/foundry-conduct`. The skill *owns the mechanism*; the conductor wiring *points at it* — do not duplicate the algorithm in two places.

## File Structure

- **Create** `.claude/skills/green-desk/SKILL.md` — the debt-path generator skill (the substance).
- **Modify** `.claude/skills/foundry-conduct/SKILL.md` — make the two tier-2 references concrete (name `/green-desk`, note Component D is now implemented). Two edit sites: the loop pseudo-protocol (~line 199) and the Pipeline-filler §Tier 2 (~line 504).
- **Modify** `.claude/skills/foundry-worker/SKILL.md` — add one EXECUTE-table row: a `green-desk-<repo>/debt-<area>` item routes through `/tech-debt` (matching scopes) + the quality floor (the rest), diff confined to the area pathPrefix.
- **Modify** `docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` — resolve §9.7 + §9.8 open questions; mark Component D / slice 4 implemented; record the resolved decisions (synthetic-product-per-repo, path-area partition, git-HEAD suppression, native-ignore + audit-ledger FP suppression, no-new-progress stop).
- **Create** `docs/foundry/green-desk/README.md` — document the ledger layout (the sweep ledger `ledger/<repo-slug>.json` schema + the `fp-ledger.md` audit-table columns) so both are auditable, not magic. (The ledger DATA files are written at sweep time by the skill; only the README is part of this PR.)

No file is large; each has one responsibility. The skill is the only nontrivial artifact.

---

## Task 1: Author the `/green-desk` skill

**Files:**
- Create: `.claude/skills/green-desk/SKILL.md`

- [ ] **Step 1: Write the frontmatter + intent**

The frontmatter `description` must trigger on the founder saying "green-desk", "sweep the desk", "drive <repo> green", "scan for debt", AND be discoverable by the conductor's tier-2 filler. Name: `green-desk`. Tags: `[foundry, green-desk, maintenance, pipeline]`. State up front: this is Component D of the autonomous-foundry design; it is a *generator* (emits cleanup items), it does NOT fix debt itself (workers do, via `/tech-debt` + the quality floor); it is the structural counterweight to per-PR nit-deferral (a ratchet, not a gate).

- [ ] **Step 2: Write the "Green-desk target" section**

Verbatim target definition (spec §D.1):
- **Drive to 0:** lint (the repo's audit set), knip (dead code / unused exports / unused deps), `tsc` type errors, Sonar bugs / vulnerabilities / security-hotspots / code-smells / duplications / cognitive-complexity violations, **every open verifier finding incl `nit`/`note`** (from the devloop twin), and TODO/FIXME/HACK debt markers.
- **Coverage** — the one higher-is-better metric: floor **80%**, target **90%** (never driven to 0).
- **Mutation** — coverage-like: at/above the tier floor, prefer higher.
- **False positives are SUPPRESSED-WITH-JUSTIFICATION, not chased.** A verified FP gets (a) a native per-tool ignore so the dimension genuinely reaches 0 AND (b) an audit-ledger entry. Never a silent ignore; never an infinite fix-loop.

- [ ] **Step 3: Write the "Procedure" section (the generator algorithm)**

Eleven numbered steps, each actionable by a cold session:
1. **Resolve targets.** `--all` → `foundry_status` products → distinct `repo`s (skip the `green-desk-*` synthetic products themselves). A named repo → just that. Map `de-braighter/<name>` → `domains/<name>/` or `layers/<name>/` (whichever exists); `de-braighter/workbench` → the cluster root.
2. **Repo-suppression check (per repo).** Read `docs/foundry/green-desk/ledger/<repo-slug>.json`. Compute `HEAD = git rev-parse origin/main` for that repo. If `ledger.lastSweptCommit === HEAD` → **SKIP** (nothing merged since the last sweep). `--force` bypasses. This is the conductor's "suppressed per repo until a merge changes it", made machine-checkable by git.
3. **No-new-progress guard.** If `ledger.consecutiveNoProgress >= 2` AND HEAD still equals the commit at which it stalled → **STOP for this repo** and surface "stuck debt" (likely needs FP-ledger entries or a founder decision); do not loop.
4. **Scan all dimensions** in the repo (off a clean `origin/main` checkout/worktree): the repo's lint, `npx knip`, `tsc --noEmit`, coverage (`ci:local` / `test:coverage`), Sonar (read localhost:9000 where wired — bugs/vulns/hotspots/smells/duplications/complexity), mutation (where wired), `grep -rn 'TODO\|FIXME\|HACK'`, and the twin's unresolved findings (`npm run dev -- findings <repo>` from `domains/devloop`, incl. `nit`/`note`). Collect every offense as `{ dimension, path, detail }`.
5. **Drop false positives.** Read `docs/foundry/green-desk/fp-ledger.md`; drop offenses matching a suppression row (by `tool` + `path` + `rule`). These are not real debt.
6. **Green check.** If, after FP-drop, every dimension is at target (0 real debt + coverage ≥ 80% + mutation ≥ floor) → the repo is **GREEN**: record the sweep (green: true, reset `consecutiveNoProgress` to 0), emit NOTHING, report green. Else continue.
7. **Partition by path-area.** Group the offending `path`s into **path-disjoint** top-level areas (natural module/dir boundaries: `libs/<x>`, `apps/<x>`, `src/<x>`, `tools/<x>`). Each area → one `debt-<area>` item covering ALL dimensions with offenses in that area. Repo-global offenses (root config, cross-area duplication) → a single `debt-root` item; area-items that would touch root files `dependsOn` it (usually none do). **Verify the partition is path-disjoint** (no area prefix is a prefix of another) — the same proof `/build-path` step 8 runs.
8. **Compute the no-progress signal.** Compare this scan's total real-offense count to `ledger.lastOffenseCount`. If the previous sweep emitted items and the count did NOT drop → increment `consecutiveNoProgress`; else reset to 0.
9. **Register + push.** `foundry_queue_push { product: { productKey: 'green-desk-<repo-slug>', name: 'Green-desk — <repo>', repo: 'de-braighter/<name>', riskTier: 'T0', priority: 200, stage: 'maintenance' }, items: [...] }` (registration is idempotent — re-push only NEW itemIds; check `foundry_status` first). Each item: `itemId: 'green-desk-<repo-slug>/debt-<area>'`, `title` naming the dimensions + offense count + a few locations (self-contained for a cold worker), `scope: { repo: 'de-braighter/<name>', pathPrefix: '<area>' }`, `qualityObligations: [<repo floor obligations>, 'green-desk-target']`, `dependsOn: ['green-desk-<repo-slug>/debt-root']` only if it touches root. **Cap at the per-cycle item cap (default 10)**; yield the rest to the next cycle.
10. **Record the sweep** in `ledger/<repo-slug>.json`: `{ repo, lastSweptCommit: HEAD, lastSweptAt, lastOffenseCount, consecutiveNoProgress, dimensions: { <dim>: <count> }, emittedItems: [...], green: <bool> }`.
11. **Report** the per-repo verdict (green / N items emitted / suppressed-no-change / stuck-debt) and, for `--all`, the roll-up.

- [ ] **Step 4: Write the "Worker routing" + "FP suppression" + "Bounds" + "Cadence" sections**

- **Worker routing:** a `debt-<area>` item is a normal foundry T0 item; the standard foundry-worker protocol claims it; EXECUTE routes through `/tech-debt` for matching scopes (dead-code→knip, token-cleanup→tokens) + direct fixes for the rest (lint `--fix`, tsc errors, Sonar smells, complexity via `/clean-decompose-optimizer`) under the quality floor; diff confined to the area `pathPrefix`; T0 green wave → squash-merge → twin ritual.
- **FP suppression (the ledger):** when an offense is a verified FP (knip declaration-emit-types / prisma-generate-dep classes per the F5 runbook), the worker/founder (a) adds the native per-tool ignore so the dimension reaches 0 AND (b) appends to `docs/foundry/green-desk/fp-ledger.md`: `| date | repo | tool | path | rule | justification | reviewer |`. Step 5 reads this so suppressed offenses are never re-emitted. Never silent.
- **Bounds (anti-livelock):** repo-suppression (git HEAD, step 2) + per-cycle cap (step 9, default 10) + no-new-progress stop (steps 3/8). A clean repo is never re-swept; the cap prevents unbounded burn; stuck debt surfaces instead of looping.
- **Cadence (spec §D.5):** primary = the conductor's autonomous IDLE tier-2 (event-driven, suppression-bounded). On-demand = `/green-desk <repo>` (or `--all`). Scheduled (weekly / after-N-merges) = a thin `CronCreate` routine invoking a green-desk-mode coordinator — noted as the explicit-cadence wrapper, not core.

- [ ] **Step 5: Write the "Failure stances" + "Output" sections**

- Foundry MCP unavailable → scan + write the ledger anyway (diagnostic); flag the push as pending; never simulate a push.
- `queue_push` rejects an itemId as already queued → diff against `foundry_status`; push only new items (a prior cycle's items still in flight).
- A repo has no Sonar/mutation wired → scan the dimensions that ARE wired; note the unscanned ones in the report (don't fabricate a 0).
- Output: per-repo `{ repo, verdict, itemsEmitted, suppressedDims, stuckDdebt }` + the queue refs.

- [ ] **Step 6: Coherence self-check + commit**

Re-read the skill against `/build-path` (the sibling generator) and `state.ts` `scopesDisjoint`: is the partition provably path-disjoint? does every itemId follow `green-desk-<repo-slug>/debt-<area>`? does the synthetic product carry the repo (not a multi-repo product)? Fix inline.

```bash
git add .claude/skills/green-desk/SKILL.md
git commit -m "feat(green-desk): debt-path generator skill (Component D)"
```

---

## Task 2: Document the ledger layout

**Files:**
- Create: `docs/foundry/green-desk/README.md`

- [ ] **Step 1: Write the README**

Document (a) the sweep ledger `ledger/<repo-slug>.json` schema (the exact keys from Task 1 step 10) + that it is git-tracked so suppression survives across sessions/machines; (b) the `fp-ledger.md` audit-table columns + the "native ignore + ledger row, never silent" rule; (c) that these are the conductor's durable green-desk memory (the conductor itself holds no state — "store generators, derive graphs"). Add a `.gitkeep` note that `ledger/` fills at sweep time.

- [ ] **Step 2: Commit**

```bash
git add docs/foundry/green-desk/README.md
git commit -m "docs(green-desk): ledger layout (sweep + FP audit ledgers)"
```

---

## Task 3: Wire green-desk into the conductor tier-2 (replace the stub)

**Files:**
- Modify: `.claude/skills/foundry-conduct/SKILL.md` (two sites: the loop pseudo-protocol TIER 2, ~line 199; the Pipeline-filler §"Tier 2 — Green-desk maintenance", ~line 504)

- [ ] **Step 1: Make the loop-pseudocode TIER 2 concrete**

Replace `TIER 2 (auto): invoke green-desk sweep (Component D) → emit debt cleanup items; suppressed per repo as described above; if new items within budget: continue loop` with a version that names the skill: invoke the `/green-desk` skill with `--all`; it OWNS repo-suppression (git HEAD vs ledger) + the per-cycle cap + the no-new-progress stop internally (do not re-implement here); if it emits items within budget → continue the loop.

- [ ] **Step 2: Make the Pipeline-filler §Tier 2 concrete**

Update the prose to: "Invoke the **`/green-desk` skill** (Component D — implemented): it scans every active repo across every debt dimension, drops FPs via the audit ledger, and emits disjoint path-area cleanup items (`green-desk-<repo>/debt-<area>`) under a synthetic `green-desk-<repo>` T0 product. The skill owns the anti-livelock mechanism (git-HEAD repo-suppression + per-cycle cap + no-new-progress stop); this filler simply invokes it and continues if items appear within budget." Keep the existing anti-livelock paragraph but note the mechanism now lives in the skill.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/foundry-conduct/SKILL.md
git commit -m "feat(foundry-conduct): wire tier-2 filler to the /green-desk skill"
```

---

## Task 4: Add the green-desk worker routing row

**Files:**
- Modify: `.claude/skills/foundry-worker/SKILL.md` (the Phase-3 EXECUTE routing table, ~line 124)

- [ ] **Step 1: Add the routing row**

Add a row: `| green-desk cleanup item (`green-desk-<repo>/debt-<area>`) | route via /tech-debt for matching scopes (dead-code, token-cleanup) + direct fixes for the rest (lint --fix, tsc, Sonar smells, complexity via /clean-decompose-optimizer) under the quality floor; diff confined to the area pathPrefix |`. One sentence below the table: the item's title names the exact dimensions + locations to fix.

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/foundry-worker/SKILL.md
git commit -m "feat(foundry-worker): route green-desk cleanup items via /tech-debt + floor"
```

---

## Task 5: Update the design spec (resolve open questions, mark Component D shipped)

**Files:**
- Modify: `docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md`

- [ ] **Step 1: Resolve §9 open questions 7 + 8**

- §9.7 (FP-suppression ledger + stop): mark **resolved** — native per-tool ignore + `docs/foundry/green-desk/fp-ledger.md` audit table (never silent); no-new-progress stop after 2 consecutive sweeps with no offense reduction at an unchanged HEAD.
- §9.8 (cadence/scope + mutation target): mark **resolved** — cadence = conductor IDLE tier-2 (primary) + on-demand `/green-desk` + optional scheduled wrapper; scope = all active foundry products' repos; mutation stays coverage-like at the tier floor (prefer higher), no separate hard target.

- [ ] **Step 2: Annotate Component D + slice 4 as implemented**

In §"Component D" add a short "Implemented (2026-06-13, item C)" note: the `/green-desk` skill + the resolved decisions (synthetic-product-per-repo forced by `toNextItem`; path-area partition forced by `scopesDisjoint`; git-HEAD suppression keeping the foundry kernel ADR-176-minimal; native-ignore + audit-ledger FP suppression). In §10 mark slice 4 done.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md
git commit -m "docs(spec): resolve green-desk open questions; mark Component D shipped"
```

---

## Task 6: Open the PR, run the verifier wave, land it

- [ ] **Step 1: Push + open the PR**

Push `feat/green-desk-sweep`; open the PR on `de-braighter/workbench` with the body carrying `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effort: standard`, `Effect: cycle-time 0.01±0.02 expert` + `Effect: findings`. Open the PR BEFORE the wave (findings must be postable).

- [ ] **Step 2: Verifier wave (review floor — non-trivial → full wave)**

Dispatch `reviewer` + `qa-engineer` + `charter-checker` in parallel, all `isolation: 'worktree'`, read-only on the pushed diff. The wave checks: the partition is provably path-disjoint; the synthetic-product modeling is correct vs `toNextItem`; no foundry-kernel growth (ADR-176); the conductor wiring references the skill correctly; the spec stays internally consistent; the inviolable boundaries are untouched (green-desk emits only T0 items, never auto-builds a product).

- [ ] **Step 3: Post findings BEFORE any fix**

Write the wave findings to a temp JSON `[{verifier, severity, path?, line?, text}]` and run `npm run dev -- post-findings de-braighter/workbench#<pr> findings.json` from `domains/devloop`.

- [ ] **Step 4: Fix blocking/critical findings; re-review if needed**

- [ ] **Step 5: Admin-merge (freeze-merge — GHA frozen)**

Gate = local `ci:local` equivalent (skill/markdown has no build; the wave is the gate) + `gh pr merge <pr> --repo de-braighter/workbench --squash --admin`. **Gate cleanup on VERIFIED-merged:** `gh pr view <pr> --json state` must equal `MERGED` before any worktree teardown (a transient `mergeable:UNKNOWN` fails the merge — retry, then verify).

- [ ] **Step 6: Twin ritual**

`npm run dev -- drain de-braighter/workbench#<pr>` (after wave) → after merge `npm run dev -- backfill de-braighter/workbench` → `npm run dev -- reconcile`. (`npm run ritual:post-merge` covers reviews + resolve-findings.)

- [ ] **Step 7: Worktree cleanup (after verified-merged only)**

`git worktree remove .claude/worktrees/green-desk` + `git branch -D feat/green-desk-sweep` from the cluster root.

---

## Self-Review (run before execution)

- **Spec coverage:** Component D §D.1–D.5 each maps to a Task-1 section (target→step2; generator→step3; dispatch/loop-until-green→step3+worker-routing; nit-counterweight→step1 intent; cadence→step4). §9.7+§9.8 → Task 5. Tier-2 wiring → Task 3. ✓
- **Placeholder scan:** no TBD/TODO in the plan; every step names exact files + exact content. ✓
- **Type/name consistency:** itemId form `green-desk-<repo-slug>/debt-<area>` and product key `green-desk-<repo-slug>` are identical everywhere; ledger keys in step 10 match the README in Task 2. ✓
- **Scope:** one workbench PR, one new skill + 4 doc/skill edits — single implementation plan, no decomposition needed. ✓
