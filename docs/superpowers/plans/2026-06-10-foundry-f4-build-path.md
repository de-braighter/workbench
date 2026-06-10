# Foundry F4 — Build-Path Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pipeline stage 4 executable: a `/build-path` skill that turns an approved Product Charter into a machine-executable build path — `/new-domain` scaffold plan, epic ladder (herdbook E1…En style), ADR needs, UI-surface plan from the dossier's prototype artifacts, tier-derived quality-battery config — decomposed into **claimable work items with disjoint scopes**, pushed via `foundry_queue_push`; plus the worked example on the agri-ecosystem-twin charter (the F4 acceptance test and the first half of the spec §6 e2e proof).

**Architecture:** One procedure skill (markdown, no code — workbench is declarative-only). The build-path artifact is tracked workbench content at `docs/foundry/<key>/build-path.md` (joins dossier-record → brief → charter). The foundry store remains the single operational truth for queue/claim state — the doc records the *design*, never mirrors queue status ("store generators, derive graphs" applied to the machine itself). The live `foundry_queue_push` is an orchestrator act AFTER the PR merges (mirrors F3's live Gate-1-after-merge pattern), so a wave-rejected ladder never pollutes the queue.

**Tech Stack:** Markdown skill; foundry MCP tools (`foundry_status` / `foundry_queue_push` / `foundry_gate_request` / `foundry_next` / `foundry_session_prompt`).

**Spec:** `docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md` §3 stage 4 + risk tiers, §4 claim protocol, §6 row F4, §7 failure stances, §8 testing. Charter input: `docs/foundry/agri-ecosystem-twin/charter.md` (T0, qualityObligations = wave-standard, coverage-delta, a11y-battery, seed-data-only, no-kernel-change).

---

## Gap-closure decisions (spec leaves open; ratified for this plan)

1. **Artifact home** — `docs/foundry/<key>/build-path.md` (tracked, PR-gated workbench content, same home as the other pipeline artifacts per F3 decision 1). The doc shape is embedded in the skill (no separate template — unlike the charter, the build path is authored by the same stage that defines it).
2. **Item grain** — one work item = one worker session = one PR (the F2 protocol works items whole). Epics too large for one session decompose into `E<n>.1, E<n>.2 …` items. itemId convention: `<product-key>/E<n>` or `<product-key>/E<n>.<m>`.
3. **Disjointness is designed against the EXACT `scopesDisjoint` algorithm** (foundry `src/state.ts:255-270`, fail-closed; pathPrefix comparison authoritative when both present — a differing issue cannot rescue overlapping paths; an item with neither issue nor pathPrefix claims the whole repo). The skill reproduces the algorithm verbatim and requires a **disjointness-proof table** over every unordered item pair. Items ordered by the dependency DAG may share scope (they can never hold claims simultaneously, because `dependsOn` requires released-`done`); unordered items must be pairwise provably disjoint.
4. **Shared-file rule** — mutations of shared surfaces (route tables, barrels, app config, root package.json) belong in a *sequencing item* that parallel items `dependsOn`; a parallel item's pathPrefix must contain every file it will touch. This is the practical trick that makes path-disjoint parallel UI/back-end lanes real.
5. **`scope.issue`** — filled when the target repo + story issues exist; greenfield products (repo not yet created) rely on pathPrefix disjointness, and worker sessions create story issues per the story-tracker workflow once the repo exists. (F1 fact: `lane` is informational only — no claim semantics.)
6. **Gate-2 mechanics** — T1/T2: after authoring the doc, `foundry_gate_request { gateType: "architecture", payloadRef: <build-path path> }` and STOP; items are pushed only after `foundry_gate_decide` approves. T0: no Gate 2, push directly. Product registration is idempotent (`foundry_queue_push { product, items: [] }` — F3 lesson).
7. **Push timing for the worked example** — the PR carries `build-path.md`; the **live** `foundry_queue_push` happens post-merge by the orchestrator, then `foundry_status` + `foundry_session_prompt` verification closes the acceptance test. (Do NOT build the agri domain — a worker session claiming `agri-ecosystem-twin/E1` under the F2 protocol is the second half of the e2e proof, a separate founder-launched session.)
8. **Re-run / correction semantics** — `foundry_queue_push` rejects existing itemIds; re-running the skill diffs against `foundry_status` and pushes only NEW items. Corrections to queued items are new itemIds (`<id>-v2`) + orchestrator releases/abandons stale ones (append-only event log). Mid-build disjointness violations (spec §7) hand the newer claim back and are fixed HERE (lane-map correction in the doc + corrected re-push).

## File structure (lock-in)

```text
de-braighter/ (workbench — built in worktree .claude/worktrees/f4-build-path)
├── .claude/skills/build-path/SKILL.md                       # NEW — stage 4
├── docs/foundry/agri-ecosystem-twin/build-path.md           # NEW — worked example
└── docs/superpowers/plans/2026-06-10-foundry-f4-build-path.md  # this plan
```

---

### Task 1: Worktree + branch

**Files:** none (git plumbing)

- [ ] **Step 1:**

```bash
cd D:/development/projects/de-braighter
git fetch origin main
git worktree add .claude/worktrees/f4-build-path -b feat/f4-build-path origin/main
```

All subsequent tasks operate inside the worktree. Never `git add -A`. Never run git checkout/stash/clean in the shared clone.

---

### Task 2: `/build-path` skill

**Files:**
- Create: `.claude/worktrees/f4-build-path/.claude/skills/build-path/SKILL.md`

- [ ] **Step 1: Write the skill** (complete content):

````markdown
---
name: build-path
description: "Foundry pipeline stage 4 — turn an approved Product Charter into a machine-executable build path: /new-domain scaffold plan, epic ladder (herdbook E1…En style), ADR needs, UI-surface plan derived from the dossier's prototype artifacts, and the tier-derived quality-battery config — decomposed into claimable work items with DISJOINT scopes and pushed via foundry_queue_push. Use when the founder says 'build-path <product-key>' or after a product's charter merges."
tags: [foundry, build-path, pipeline]
---

# Build Path (Foundry stage 4)

Turns `docs/foundry/<key>/charter.md` into the full build path (spec §3 stage 4 of
`docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md`).
**The load-bearing output is scope disjointness**: parallel worker sessions are
safe at claim time exactly because disjointness was *designed* here — F1's
`scopesDisjoint` only enforces what this stage designs.

## The disjointness algorithm (design against EXACTLY this)

The claim plane (foundry `scopesDisjoint`, fail-closed) treats two item scopes
as disjoint iff:

1. different `repo` → disjoint;
2. same repo, BOTH scopes carry `pathPrefix` → disjoint iff neither normalized
   prefix (compare with trailing `/`) is a prefix of the other. **Path
   comparison is authoritative: a differing `issue` canNOT rescue overlapping
   paths.**
3. same repo, at least one scope without `pathPrefix` → disjoint iff both carry
   `issue` and the issues differ;
4. anything else → OVERLAP. An item with neither `issue` nor `pathPrefix`
   claims the **whole repo**.

Claimability: an item is claimable when it is still queued (not done, not
actively claimed), its `dependsOn` items are all released `done`, AND its scope
is disjoint from every ACTIVE claim. Design consequences:

- Items **ordered** by the dependency DAG (one transitively depends on the
  other) may share scope — they can never hold claims simultaneously.
- Items **unordered** relative to each other MUST be pairwise disjoint by
  rules 1–3.
- **Shared files break path disjointness** — mutations of shared surfaces
  (route tables, module barrels, app config, root package.json) belong in a
  *sequencing item* that the parallel items `dependsOn`; a parallel item's
  pathPrefix must contain every file it will touch.
- `lane` is informational labeling only (no claim semantics); the real
  parallelism contract is `dependsOn` + disjoint scopes.

## Rules

- **The charter is the authority.** Tier, wedge, what-NOT-to-build, quality
  plan. The build path never widens the wedge; an item that needs something the
  charter excludes is a design smell to surface, not to queue.
- **qualityObligations are copied VERBATIM from the charter's quality plan**
  onto every item they apply to (universal obligations on all items;
  UI-specific ones like `a11y-battery` on UI-scoped items). Never add
  obligations the charter doesn't carry (a T0 charter has no mutation
  threshold).
- **Item grain = one worker session = one PR** (the F2 foundry-worker protocol
  works items whole: claim → worktree → execute → wave → land → release). An
  epic too large for one session decomposes into `E<n>.1, E<n>.2 …` items.
- **Item titles are self-contained.** A worker session sees ONLY the itemId,
  title, scope, and obligations (plus what it reads from the repo + the
  build-path doc). Write titles a cold session can act on.
- **Store generators, derive graphs:** the foundry store is the single
  operational truth for queue/claim state. The build-path doc records the
  *design* — never mirror queue status into it.

## Procedure

1. **Read the inputs.** `docs/foundry/<key>/charter.md` (must exist with
   `status: chartered`), `opportunity-brief.md`, `dossier-record.md` + the
   UI-prototype artifacts it manifests. Missing charter → stop and name the
   missing pipeline stage (`/dossier-intake` → `/opportunity-brief` → charter).
2. **Scaffold plan.** From the charter's Repo plan: target repo, `/new-domain`
   tiers, suggested port pair (grep `repos.yaml` + `domains/*/docker-compose.yml`
   for taken ports, suggest the next free pair). For a greenfield repo the
   scaffold is **E1**: scope = whole repo (no pathPrefix, no issue — claims the
   repo), and every other item transitively `dependsOn` it.
3. **Epic ladder** (herdbook E1…En convention): each epic is a user-facing
   capability with a one-line deliverable + an acceptance statement, decomposed
   into items at the one-session grain. Honor the wedge: the ladder ends when
   the charter's end-to-end loop demonstrably runs — not when the dossier's
   full vision ships.
4. **UI-surface plan.** From the dossier's UI-prototype artifacts: list each
   prototype surface, judge it against the charter's wedge loop (`in` /
   `deferred` + one-line justification), and map in-scope surfaces onto
   design-system-brick pages. Each in-scope surface becomes an item under a UI
   epic, pathPrefix'd to its own page directory; the UI shell (routing, app
   config, shared layout) is a sequencing item the surface items `dependsOn`.
5. **ADR needs.** List the ADRs the path requires. T0: expected none
   (pack-native; an apparent kernel need is a charter design smell to escalate,
   not to build). T1: the ADR set goes to Gate 2. T2: additionally mark
   affected items `designer-first` and note the per-ADR founder gates (spec §3).
6. **Quality battery config.** Derive from the tier row + charter quality
   plan: which deterministic gates run for this product (lint audit set, knip,
   coverage-delta, mutation tier, non-superuser DB tests, a11y battery) and
   which obligations land on which items (an applicability table).
7. **Decompose into work items.** For each item: `itemId` (`<key>/E<n>` or
   `<key>/E<n>.<m>`), `title`, `epic`, `scope` (`repo` + `pathPrefix` and/or
   `issue` — greenfield products rely on pathPrefix), `dependsOn` (itemIds),
   `lane`, `qualityObligations`. `scope.issue` is filled when the target repo +
   story issues exist; worker sessions create story issues per the
   story-tracker workflow once the repo exists.
8. **Disjointness proof.** Enumerate every UNORDERED pair (neither transitively
   depends on the other) in a table: pair → evidence (`different repo` /
   `non-nested paths: <a> vs <b>` / `distinct issues`) → verdict. Any pair
   without provable evidence: re-scope (tighter pathPrefixes), move shared
   files into a sequencing item, or add ordering. Never rely on
   issue-distinctness when both items carry overlapping paths (rule 2). Also
   verify every `dependsOn` id appears in the item list (or is already queued
   for this product) — queue_push accepts dangling ids silently, and a dangling
   dependency bricks its item forever (its deps can never be satisfied).
9. **Write the doc** `docs/foundry/<key>/build-path.md`:

   ```markdown
   ---
   product_key: <key>
   build_path_date: <YYYY-MM-DD>
   status: build-path
   charter: docs/foundry/<key>/charter.md
   risk_tier: <from charter>
   item_count: <n>
   ---

   # Build Path — <Product Name>

   ## Scaffold plan
   ## Epic ladder
   ## UI-surface plan
   ## ADR needs & gates
   ## Quality battery config
   ## Lanes & parallelism
   ## Work items
   <table: itemId · title · scope · dependsOn · lane · qualityObligations>
   ## Disjointness proof
   <the unordered-pair table>
   ```

10. **Gate 2 — T1+ only.** T1/T2: register the product if needed
    (`foundry_queue_push { product, items: [] }` is idempotent — F3 lesson),
    then `foundry_gate_request { productKey: <key>, gateType: "architecture",
    payloadRef: "docs/foundry/<key>/build-path.md" }` and STOP — items are
    pushed only after `foundry_gate_decide` approves. T0: no Gate 2 — proceed.
11. **Push.** Check `foundry_status` first: itemIds must be NEW (queue_push
    rejects existing ones — never re-push). Then `foundry_queue_push {
    product: { productKey, name, repo, riskTier, charterRef, stage:
    "execution" }, items: [<the full item list>] }`. For an already-registered
    product the product block is ignored (registration is write-once via the
    MCP surface) — the charter FILE stays the tier authority either way.
12. **Verify + hand off.** `foundry_status` shows the items queued with only
    dependency-free ones claimable; `foundry_next` surfaces them;
    `foundry_session_prompt` renders ready-to-paste launch prompts. Report the
    board + the first prompt(s) to the founder (hybrid spawn: the founder
    launches worker sessions).

## Failure stances

- **Foundry MCP unavailable** → author the doc anyway (it's a file); flag the
  push as pending; never simulate a push. (If `foundry_*` tools are absent the
  session needs a restart — they're wired in `.mcp.json`.)
- **queue_push rejects an itemId as already queued** → diff against
  `foundry_status`; push only the new items. Corrections to already-queued
  items: push the corrected item as a NEW itemId (`<id>-v2`), then RETIRE the
  stale item — claim it and release with outcome `done` and note
  `superseded by <id>-v2; do not implement` (the only terminal outcome:
  `abandoned` re-queues, and the stale item's older `queuedAt` would surface it
  BEFORE the v2 and suppress the v2 in session prompts). A stale item that is
  not yet claimable (pending deps) cannot be retired today — flag it to the
  orchestrator and retire it the moment it becomes claimable; an F1 retire op
  is the known gap.
- **Mid-build disjointness violation** (spec §7: two in-flight items turn out
  to touch the same file) → the older claim proceeds, the newer session hands
  back via `foundry_handoff`; THIS stage owns the fix: correct the lane map /
  scopes in `build-path.md`, push the corrected items as new itemIds, and
  retire the handed-back item (claim → release `done` with a superseded-by
  note) — the retire-claim is only possible once the older overlapping claim
  has released; until then the handoff note is the guard.
- **Gate 2 rejected** → revise per the founder's note; new gate request;
  nothing is pushed until approved.
- **The charter excludes something the ladder seems to need** → do not queue
  it; surface the conflict to the founder (a charter change is a founder
  decision, not a build-path edit).
````

- [ ] **Step 2: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f4-build-path
git add .claude/skills/build-path/SKILL.md
git commit -m "feat(skills): build-path — Foundry stage 4 (charter -> epic ladder -> disjoint claimable items)"
```

---

### Task 3: Worked example — agri-ecosystem-twin build path (dry run, spec §8)

**Files:**
- Create: `.claude/worktrees/f4-build-path/docs/foundry/agri-ecosystem-twin/build-path.md`

- [ ] **Step 1: Execute `/build-path` BY THE SKILL TEXT** (Task 2's procedure, literally — this validates the skill) against the REAL charter `docs/foundry/agri-ecosystem-twin/charter.md`. Grounding facts (the executor derives the ladder honestly, but within these):
  - **Inputs:** charter (T0, wedge = one farm / one season / cover-crop-A-vs-B / soil-moisture+pest-pressure+yield / seed data only / port the React prototype; what-NOT = no IoT, no MRV, no full nesting, no extra indicators, no bespoke simulator, no kernel change), `opportunity-brief.md`, `dossier-record.md` (UI-prototype artifacts: `app.jsx` shell, `map.jsx` topographic canvas, `inspector.jsx` plot inspector + plan builder, `panels.jsx` scenario/weather/tree/log/rollup, `data.js` synthetic dataset + projection, 16 screenshots).
  - **Repo `de-braighter/agri-ecosystem-twin` does not exist** → E1 = `/new-domain` scaffold, ALL six tiers per the charter repo plan (spine + pack + api + db-persistence + inference-backbone + Angular UI), whole-repo scope (no pathPrefix, no issue), everything else transitively `dependsOn` it. Suggest the next free port pair (grep `repos.yaml` + `domains/*/docker-compose.yml`; known taken: exercir 3100/5545, herdbook 3200/5433, markets 3300/5455).
  - **qualityObligations verbatim from the charter:** `wave-standard`, `coverage-delta`, `seed-data-only`, `no-kernel-change` on ALL items; `a11y-battery` additionally on UI-scoped items (charter: "on every UI surface"). NO mutation threshold, NO rls-proofs (T0 charter explicitly defers those — adding them is a plan failure).
  - **The ladder ends at the charter loop:** build a plan → run the A-vs-B counterfactual via the inference backbone → read indicator posteriors with uncertainty → advisor-report view. Expected shape ≈ 4–6 epics / ≈ 6–10 items, e.g. E1 scaffold → E2 domain model + seeded event_log (subjects plot→field→farm, season plan tree, cover-crop interventions with effect declarations, synthetic observations) → E3 counterfactual readout API (A-vs-B via `counterfactual()`, posterior endpoints) → E4 UI shell (routing/layout/config sequencing item) then parallel UI surface items → E5 advisor report + e2e demo polish. This is indicative, NOT prescriptive — the executor derives the real ladder from the inputs; what is binding is the wedge boundary, the grain, and the disjointness proof.
  - **UI-surface plan:** judge each prototype surface against the wedge loop. The plan-builder, counterfactual A/B split + indicator posteriors readout, subjects tree, and advisor report serve the loop; the full topographic map canvas (`map.jsx`) is `deferred` unless the executor can justify it inside the wedge (justify either way). Parallel UI surface items get their own page-directory pathPrefixes and `dependsOn` the UI-shell sequencing item (skill rule: shared files live in the sequencing item).
  - **T0 → no Gate 2.** Do NOT call any foundry tool in this task — author the doc only. The live push is the orchestrator's post-merge act (gap decision 7).

- [ ] **Step 2: Self-check** — frontmatter valid (`product_key: agri-ecosystem-twin`, `risk_tier: T0`, `item_count` matches the items table); every itemId unique and prefixed `agri-ecosystem-twin/`; every item has repo `de-braighter/agri-ecosystem-twin`; every non-E1 item transitively dependsOn E1; the disjointness-proof table covers EVERY unordered pair with concrete evidence (run the algorithm by hand on each); obligations exactly the charter set with a11y-battery only on UI-scoped items; nothing the charter's What-NOT-to-build excludes appears as an item.

- [ ] **Step 3: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f4-build-path
git add docs/foundry/agri-ecosystem-twin/build-path.md
git commit -m "docs(foundry): worked example — agri-ecosystem-twin build path (epic ladder + disjointness proof, spec §8 dry run)"
```

---

### Task 4: Plan copy + push + PR

**Files:**
- Create (copy): the plan into the worktree `docs/superpowers/plans/`

- [ ] **Step 1: Copy + commit the plan**

```powershell
Copy-Item "D:/development/projects/de-braighter/docs/superpowers/plans/2026-06-10-foundry-f4-build-path.md" "D:/development/projects/de-braighter/.claude/worktrees/f4-build-path/docs/superpowers/plans/"
```

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f4-build-path
git add docs/superpowers/plans/2026-06-10-foundry-f4-build-path.md
git commit -m "docs(plan): F4 build-path designer — gap decisions + 4-task plan"
```

- [ ] **Step 2: Push + PR** (body via `--body-file` — PS 5.1 mangles multi-line `--body`):

```bash
git push -u origin feat/f4-build-path
gh pr create --repo de-braighter/workbench --title "feat(skills): F4 build-path designer — charter -> epic ladder -> disjoint claimable items" --body-file <temp file>
```

PR body:

```text
## F4 — Build-path designer (Foundry spec §3 stage 4)

- `/build-path` — charter → scaffold plan + epic ladder (herdbook E1…En) + ADR needs + UI-surface plan + tier-derived quality-battery config, decomposed into claimable work items with DISJOINT scopes (designed against the exact F1 scopesDisjoint algorithm, with a mandatory unordered-pair disjointness proof). T1+ products gate on architecture approval (Gate 2) before any push; T0 pushes directly.
- Worked example: agri-ecosystem-twin build path (docs/foundry/agri-ecosystem-twin/build-path.md) — the F4 acceptance test + first half of the spec §6 e2e proof. Live foundry_queue_push happens post-merge (orchestrator), then foundry_status/foundry_session_prompt verification.
- Plan: docs/superpowers/plans/2026-06-10-foundry-f4-build-path.md

Producer: orchestrator/claude-fable-5 [superpowers:writing-plans, superpowers:subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then the orchestrator: foreground wave (reviewer + qa-engineer + charter-checker; each prompt FORBIDS git checkout/stash/clean/reset in shared clones — inspect PR heads via `git -C <repo> fetch origin pull/N/head` + diff/show, own worktrees only), `post-findings` (severities `blocking|should-fix|nit|note`, paths anchored IN the diff, FULL `de-braighter/workbench#<pr>`) BEFORE pushing fix commits, merge, twin ritual (drain → backfill → reconcile), worktree removal — then the live queue push + verification (separate orchestrator step, gap decision 7).

---

## Self-review notes (run during plan-writing)

- **Spec coverage:** §3 stage 4 deliverables — scaffold plan (skill step 2), epic ladder (step 3), ADR needs (step 5), UI-surface plan from prototype artifacts (step 4), quality-battery config (step 6), disjoint claimable items (steps 7–8), lanes marked (doc section + `lane` field), T1+ Gate 2 (step 10) → all present. §4 claim protocol facts (claim-at-session-start, issue-grain, overlap rejection) → reflected in the algorithm section. §7 failure stances (mid-build violation → handoff + lane-map correction here) → failure stances. §6/§8 worked example → Task 3.
- **Placeholder scan:** skill body complete; Task 3 is deliberately procedural (the worked example IS the skill's acceptance test — prescribing the full ladder verbatim would defeat the dry run) but pins the inputs, the binding constraints (wedge boundary, obligations set, E1 shape, proof-table requirement), and the self-checks.
- **Consistency:** `docs/foundry/<key>/build-path.md` path identical across skill, worked example, PR body; the scopesDisjoint description matches foundry `src/state.ts:255-270` (fail-closed, trailing-`/` normalization, path-authoritative, whole-repo claim when neither field present); obligations list matches the charter verbatim; itemId convention `<key>/E<n>[.<m>]` used throughout.
