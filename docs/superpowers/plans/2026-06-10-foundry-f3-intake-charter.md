# Foundry F3 — Intake & Charter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pipeline stages 1–3 of the Foundry executable: a `/dossier-intake` skill (dossier → normalized Dossier Record + canonical assets), an `/opportunity-brief` skill (substrate-fit decomposition + codified 8-dimension rubric + risk-tier recommendation + Gate-1 request), a charter template (with the spec §3 tier policy), and a worked example on the Agricultural Ecosystem Twin dossier.

**Architecture:** Both skills are procedure skills (markdown, no code — workbench is declarative-only). Pipeline artifacts are tracked workbench content under `docs/foundry/<product-key>/` (`dossier-record.md` → `opportunity-brief.md` → `charter.md` + `assets/`); `docs/ideas-inbox/` stays untracked and immutable (zips + founder scratch — intake COPIES out, never moves). Gate 1 is a real `foundry_gate_request(greenlight)` record, not a chat message. The rubric codifies `docs/ideas-inbox/substrate_saas_opportunity_dossier/.../01_overview_and_scoring.md` (8 dimensions, 1–5, /40) and adds the spec's four-kernel-concern decomposition as the substrate-fit gate.

**Tech Stack:** Markdown skills + templates; PowerShell `Expand-Archive` for zip intake; foundry MCP tools for the gate.

**Spec:** `docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md` §3 stages 1–3 + risk tiers, §6 row F3, §8 testing (fixture corpus = the 14 real dossiers).

---

## Gap-closure decisions (spec leaves open; ratified for this plan)

1. **Artifact home** — `docs/foundry/<product-key>/` in the workbench (tracked, PR-gated). The foundry server stores no knowledge (spec §4 non-goals); the specs repo is for ratified concepts/ADRs, not pipeline working artifacts; the workbench already hosts the inbox.
2. **Product key** — kebab-case derived from the idea name (`Agricultural Ecosystem Twin` → `agri-ecosystem-twin`), founder-overridable at intake.
3. **Nothing-lost rule made checkable** — the Dossier Record carries an asset manifest table; every file in the source dossier appears in it (count check: manifest rows == source file count).
4. **Rubric** — keep the demonstrated 8 dimensions verbatim; ADD a substrate-fit decomposition section (four kernel concerns, each judged `natural | forced | absent`) and a reuse inventory. An idea with any `absent` core concern cannot recommend T1+ build (it's not substrate-shaped — recommend defer or T0 experiment).
5. **Gate-1 mechanics** — `/opportunity-brief` ends by asking the founder; on go-ahead it calls `foundry_gate_request { productKey, gateType: "greenlight", payloadRef: <brief path> }`. The charter is authored only AFTER `foundry_gate_decide` approval, from `templates/charter/template.md`.
6. **Tier policy home** — the spec §3 tier table is reproduced in the charter template (the charter is where the tier binds); skills reference it rather than restating.
7. **Worked example** — intake + brief run on `Agricultural Ecosystem Twin` (spec §6 names it for the first proof) and ship in the PR; the run stops BEFORE Gate 1 (the gate request is made live by the orchestrator after merge, as the founder touchpoint).

## File structure (lock-in)

```text
de-braighter/ (workbench — built in worktree .claude/worktrees/f3-intake-charter)
├── .claude/skills/dossier-intake/SKILL.md       # NEW — stage 1
├── .claude/skills/opportunity-brief/SKILL.md    # NEW — stage 2 (+ Gate-1 request)
├── templates/charter/template.md                # NEW — stage 3 artifact shape + §3 tier policy
├── docs/foundry/agri-ecosystem-twin/            # NEW — worked example
│   ├── dossier-record.md
│   ├── opportunity-brief.md
│   └── assets/06_agricultural_ecosystem_twin.md # copied from the inbox extraction
└── docs/superpowers/plans/2026-06-10-foundry-f3-intake-charter.md  # this plan
```

---

### Task 1: Worktree + branch

**Files:** none (git plumbing — controller does this)

- [ ] **Step 1:**

```bash
cd D:/development/projects/de-braighter
git fetch origin main
git worktree add .claude/worktrees/f3-intake-charter -b feat/f3-intake-charter origin/main
```

All subsequent tasks operate inside the worktree. Never `git add -A`.

---

### Task 2: `/dossier-intake` skill

**Files:**
- Create: `.claude/worktrees/f3-intake-charter/.claude/skills/dossier-intake/SKILL.md`

- [ ] **Step 1: Write the skill** (complete content):

````markdown
---
name: dossier-intake
description: "Foundry pipeline stage 1 — ingest an idea dossier (zip or folder, typically from docs/ideas-inbox/) into a normalized Dossier Record with a canonical, addressable asset layout under docs/foundry/<product-key>/. Use when the founder says 'intake <dossier>', 'ingest this idea', or drops a new dossier into the ideas inbox."
tags: [foundry, intake, pipeline]
---

# Dossier Intake (Foundry stage 1)

Turns a raw idea dossier into a **Dossier Record**: nothing is lost, everything
becomes addressable. Spec §3 stage 1 of
`docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md`.

## Rules

- **The inbox is immutable.** `docs/ideas-inbox/` is untracked founder material —
  COPY out of it; never move, edit, or delete anything there.
- **Nothing lost.** Every file in the source dossier appears in the record's
  asset manifest. Check: manifest row count == source file count.
- **One dossier, one product key, one folder.** Re-running intake on the same
  dossier updates `docs/foundry/<key>/` in place (idempotent), never forks a
  second folder.

## Procedure

1. **Resolve the source.** Input is a path or a name under `docs/ideas-inbox/`:
   - Zip not yet extracted → `Expand-Archive` into
     `docs/ideas-inbox/_extracted/<zip-stem>/` (the established layout), then
     use that folder.
   - Already-extracted folder (or a loose folder) → use it directly.
2. **Derive the product key** — kebab-case of the idea name
   (`Agricultural Ecosystem Twin` → `agri-ecosystem-twin`). Confirm with the
   founder if they're present; otherwise proceed and note the key is
   founder-overridable until the charter binds it.
3. **Create the canonical layout** — `docs/foundry/<key>/assets/`: copy every
   source file, preserving relative paths under `assets/`.
4. **Read everything** (markdown, scratchpads, SVG titles, deck text) and write
   `docs/foundry/<key>/dossier-record.md`:

   ```markdown
   ---
   product_key: <key>
   source: docs/ideas-inbox/<original>
   intake_date: <YYYY-MM-DD>
   status: intake
   ---

   # Dossier Record — <Idea Name>

   ## Essence
   <One paragraph: what the idea IS. Then 3-6 bullets of its core claims.>

   ## Domain-model hints
   <Entities, events, interventions, decisions spotted in the material —
   the raw ore the build-path designer (F4) will mine. Bullets, cite the
   asset file each hint came from.>

   ## UI-prototype artifacts
   <List any mockups/SVGs/frontend prototypes with one line on what each shows;
   "none" if none.>

   ## Market signal
   <Whatever the dossier claims about buyers, pain, pricing — verbatim-ish,
   flagged as the founder's untested hypotheses.>

   ## Asset manifest
   | Asset | Type | What it is |
   | --- | --- | --- |
   <one row per file under assets/>

   ## Open questions
   <What the dossier does NOT answer that stage 2 will need.>
   ```

5. **Verify the nothing-lost check** (manifest rows == file count), report the
   record path, and point at the next stage: `/opportunity-brief <key>`.

## Failure stances

- Source unreadable / zip corrupt → report which file; ingest the rest; list
  the casualty in Open questions. Never silently drop material.
- Name collision with an existing `docs/foundry/<key>/` for a DIFFERENT idea →
  stop and ask the founder for a key.
````

- [ ] **Step 2: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f3-intake-charter
git add .claude/skills/dossier-intake/SKILL.md
git commit -m "feat(skills): dossier-intake — Foundry stage 1 (dossier -> Dossier Record, nothing lost)"
```

---

### Task 3: `/opportunity-brief` skill

**Files:**
- Create: `.claude/worktrees/f3-intake-charter/.claude/skills/opportunity-brief/SKILL.md`

- [ ] **Step 1: Write the skill** (complete content):

````markdown
---
name: opportunity-brief
description: "Foundry pipeline stage 2 — score a Dossier Record's substrate fit (four-kernel-concern decomposition + pack/primitive reuse) and the 8-dimension opportunity rubric, recommend a risk tier, and tee up founder Gate 1 (greenlight) as a foundry gate record. Use when the founder says 'brief <product-key>' or after /dossier-intake completes."
tags: [foundry, assessment, pipeline]
---

# Opportunity Brief (Foundry stage 2)

Scores **substrate fit** — does the idea decompose into the four kernel
concerns? — plus the opportunity rubric demonstrated in
`docs/ideas-inbox/substrate_saas_opportunity_dossier/substrate_saas_opportunity_dossier/01_overview_and_scoring.md`.
Output: `docs/foundry/<key>/opportunity-brief.md`. Spec §3 stage 2.

## Procedure

1. **Read** `docs/foundry/<key>/dossier-record.md` + every asset it manifests.
   No record → run `/dossier-intake` first; never brief from a raw dossier.
2. **Substrate-fit decomposition** — for each kernel concern, say what it would
   concretely be for this idea and judge `natural | forced | absent`:
   - **Plan tree** — what is the single-parent intervention/plan structure?
   - **Event log** — what observations stream in, from where?
   - **Inference** — what posteriors/twins/counterfactuals would users buy?
   - **Reproducibility** — what needs versioned catalogs / replay?
   **Gate rule:** any core concern `absent` → the idea is not substrate-shaped;
   the brief may recommend at most a T0 experiment or `defer`, never a T1+ build.
3. **Reuse inventory** — which existing cluster assets apply (kernel event_log +
   inference backbone, design-system bricks, herdbook/exercir/markets patterns,
   devloop loop, …). Name concrete packages/patterns, not vibes.
4. **Rubric scorecard** — the 8 demonstrated dimensions, scores 1–5, total /40:
   Strategic fit · Market pain · Buyer clarity · Data feasibility ·
   MVP feasibility · Differentiation · Regulatory ease · Platform leverage.
   One sentence of justification per score — a bare number is not a score.
5. **Risk-tier recommendation** — T0 prototype/demo, T1 product, T2 regulated
   (spec §3; the tier table lives in `templates/charter/template.md`). Justify
   against regulatory burden + blast radius.
6. **Recommendation** — build now / defer / decline, the wedge (narrowest
   valuable first slice), and 3-5 what-NOT-to-build candidates for the charter.
7. **Write** `docs/foundry/<key>/opportunity-brief.md`:

   ```markdown
   ---
   product_key: <key>
   brief_date: <YYYY-MM-DD>
   status: brief
   substrate_fit: natural | partial | absent
   rubric_total: <n>/40
   recommended_tier: T0 | T1 | T2
   recommendation: build | defer | decline
   ---

   # Opportunity Brief — <Idea Name>

   ## Substrate-fit decomposition
   ## Reuse inventory
   ## Scorecard
   ## Risk tier
   ## Recommendation & wedge
   ## What NOT to build (charter candidates)
   ```

8. **Gate 1 (founder greenlight).** Present the brief summary. If the founder
   says go: `foundry_gate_request { productKey: <key>, gateType: "greenlight",
   payloadRef: "docs/foundry/<key>/opportunity-brief.md" }` and report the
   gateId. The **charter** (`templates/charter/template.md` →
   `docs/foundry/<key>/charter.md`) is authored only AFTER
   `foundry_gate_decide` approves — the charter binds name, tier, scope,
   what-NOT-to-build, quality plan, gate schedule.

## Failure stances

- Foundry MCP unavailable → write the brief anyway (it's a file); flag that the
  gate record is pending and must be requested when the MCP is back. Never
  treat a chat "looks good" as a decided gate.
- Founder rejects at Gate 1 → record stays with `recommendation` unchanged;
  set frontmatter `status: declined`; nothing is deleted.
````

- [ ] **Step 2: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f3-intake-charter
git add .claude/skills/opportunity-brief/SKILL.md
git commit -m "feat(skills): opportunity-brief — Foundry stage 2 (substrate-fit + rubric + Gate-1 request)"
```

---

### Task 4: Charter template (+ §3 tier policy)

**Files:**
- Create: `.claude/worktrees/f3-intake-charter/templates/charter/template.md`

- [ ] **Step 1: Write the template** (complete content):

````markdown
---
title: Product Charter (Foundry Gate 1 artifact)
last_updated: 2026-06-10
---

# Product Charter — <Product Name>

> Authored at Gate 1 (founder greenlight, recorded via `foundry_gate_decide`).
> The charter FIXES what downstream stages parameterize on (spec §3 stage 3);
> changing the risk tier later is a new founder gate, not an edit.

```markdown
---
product_key: <key>
charter_date: <YYYY-MM-DD>
risk_tier: T0 | T1 | T2
greenlight_gate: <gateId>
status: chartered
brief: docs/foundry/<key>/opportunity-brief.md
---

# Charter — <Product Name>

## Name & key
<Product name, product_key, one-line pitch.>

## Risk tier
<The chosen tier + WHY, against this policy (spec §3):>

| Tier | Examples | Gates | Quality parameters |
| --- | --- | --- | --- |
| **T0** prototype/demo | markets, gridiron | greenlight + ship | wave standard, auto-merge OK |
| **T1** product | herdbook, exercir | + architecture approval | wave + deep effort on kernel-touching items, mutation thresholds enforced |
| **T2** regulated | oncology (MDR Class IIb) | + every kernel-touching ADR + designer-first mandatory | full battery, RLS/tenancy proofs required, no auto-merge |

## Scope (the wedge)
<The narrowest valuable first slice, from the brief — sharpened.>

## What NOT to build
<Explicit exclusions. Each line saves a future session from scope creep.>

## Quality plan
<Tier-derived obligations that become `qualityObligations` on queue items
(F4 consumes these verbatim), e.g. `mutation>=60`, `a11y-battery`,
`rls-proofs`, `non-superuser-testcontainers`.>

## Gate schedule
<Which founder gates at which milestones, per the tier row above.>

## Repo plan
<Domain repo name (`de-braighter/<key>`), `/new-domain` scaffold tiers needed
(spine/pack/api/db/inference/ui), packages consumed.>
```
````

- [ ] **Step 2: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f3-intake-charter
git add templates/charter/template.md
git commit -m "docs(templates): product-charter template — Gate-1 artifact with the spec §3 tier policy"
```

---

### Task 5: Worked example — Agricultural Ecosystem Twin (dry run, spec §8)

**Files:**
- Create: `.claude/worktrees/f3-intake-charter/docs/foundry/agri-ecosystem-twin/dossier-record.md`
- Create: `.claude/worktrees/f3-intake-charter/docs/foundry/agri-ecosystem-twin/assets/06_agricultural_ecosystem_twin.md`
- Create: `.claude/worktrees/f3-intake-charter/docs/foundry/agri-ecosystem-twin/opportunity-brief.md`

- [ ] **Step 1: Execute `/dossier-intake` BY THE SKILL TEXT** (Task 2's procedure, literally — this validates the skill) against source `docs/ideas-inbox/_extracted/Agricultural Ecosystem Twin/` (one file: `uploads/06_agricultural_ecosystem_twin.md` — read it from the MAIN clone's inbox, copy into the worktree's `assets/`). Write the dossier record per the skill's template. The manifest has exactly 1 row.

- [ ] **Step 2: Execute `/opportunity-brief` BY THE SKILL TEXT** (Task 3's procedure). Ground facts to use: the existing scoring (01_overview_and_scoring.md row 5: Strategic fit 5, Market pain 4, Buyer clarity 4, Data feasibility 3, MVP feasibility 3, Differentiation 5, Regulatory ease 4, Platform leverage 5 = 33/40) may inform but the brief must re-derive scores with one-sentence justifications; substrate-fit decomposition must name the concrete plan-tree (season/intervention plans), event-log (sensor + operations observations), inference (yield/intervention posteriors), reproducibility (catalog of intervention subtrees) shapes; reuse inventory should name kernel event_log + inference backbone + herdbook lineage patterns. Recommended tier: T0 (per spec §3 examples) unless the material argues otherwise. Do NOT request the gate (the orchestrator does that live, after merge).

- [ ] **Step 3: Self-check** — record + brief carry valid frontmatter; manifest row count == asset file count (1); brief frontmatter `recommended_tier`/`rubric_total` filled.

- [ ] **Step 4: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f3-intake-charter
git add docs/foundry/agri-ecosystem-twin
git commit -m "docs(foundry): worked example — Agricultural Ecosystem Twin through intake + brief (spec §8 dry run)"
```

---

### Task 6: Plan copy + push + PR

**Files:**
- Create (copy): the plan into the worktree `docs/superpowers/plans/`

- [ ] **Step 1: Copy + commit the plan**

```powershell
Copy-Item "D:/development/projects/de-braighter/docs/superpowers/plans/2026-06-10-foundry-f3-intake-charter.md" "D:/development/projects/de-braighter/.claude/worktrees/f3-intake-charter/docs/superpowers/plans/"
```

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f3-intake-charter
git add docs/superpowers/plans/2026-06-10-foundry-f3-intake-charter.md
git commit -m "docs(plan): F3 intake & charter — gap decisions + 6-task plan"
```

- [ ] **Step 2: Push + PR** (body via `--body-file` — PS 5.1 mangles multi-line `--body`):

```bash
git push -u origin feat/f3-intake-charter
gh pr create --repo de-braighter/workbench --title "feat(skills+templates): F3 intake & charter — dossier-intake, opportunity-brief, charter template, worked example" --body-file <temp file>
```

PR body:

```text
## F3 — Intake & charter (Foundry spec §3 stages 1–3)

- `/dossier-intake` — dossier → Dossier Record + canonical assets under docs/foundry/<key>/ (nothing-lost manifest check; inbox immutable).
- `/opportunity-brief` — substrate-fit decomposition (four kernel concerns, gate rule: any absent → no T1+ recommendation) + codified 8-dim rubric + risk tier + Gate-1 request via foundry_gate_request.
- `templates/charter/template.md` — the Gate-1 artifact; §3 tier policy table; quality plan feeds F4's qualityObligations.
- Worked example: Agricultural Ecosystem Twin through both stages (spec §8 dry run; first half of the §6 e2e proof).
- Plan: docs/superpowers/plans/2026-06-10-foundry-f3-intake-charter.md

Producer: orchestrator/claude-fable-5 [superpowers:writing-plans, superpowers:subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then the orchestrator: foreground wave (reviewer + qa-engineer + charter-checker; each prompt FORBIDS git checkout/stash/clean in shared clones — inspect via `git -C <repo> fetch` + `diff/show`, own worktrees only), `post-findings` (severities `blocking|should-fix|nit|note`, paths anchored IN the diff) before fixes, merge, twin ritual, worktree removal, then live Gate-1 request for `agri-ecosystem-twin` surfaced to the founder.

---

## Self-review notes (run during plan-writing)

- **Spec coverage:** §3 stage 1 (intake → Dossier Record, canonical assets, nothing lost) → Task 2; stage 2 (substrate-fit scoring, rubric codification, Opportunity Brief) → Task 3; stage 3 (charter fixes name/tier/scope/what-NOT/quality plan/gate schedule, the only universal gate) → Task 4 + gate mechanics in Task 3 step 8; §6 F3 deliverables all present (two skills, charter template, tier policy); §8 fixture-corpus dry run → Task 5; "file-backed first, Foundry-backed once F1 lands" → gates are foundry-backed (F1 live), artifacts file-backed by design.
- **Placeholder scan:** skill/template bodies are complete; Task 5 is deliberately procedural (its output is the skills' acceptance test — prescribing the full record verbatim would defeat the dry run) but pins the source file, the structure, the grounding facts, and the self-checks.
- **Consistency:** product key `agri-ecosystem-twin` used throughout; `docs/foundry/<key>/` paths identical across skills, template, and example; tier table verbatim from spec §3; gate flow (request at brief, decide before charter) consistent between Task 3 and Task 4.
