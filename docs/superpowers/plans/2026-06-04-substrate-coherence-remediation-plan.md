# Substrate Coherence Remediation — Do-Now Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the non-breaking "do-now" remediation set from the program spec — make the spec record trustworthy (WS-1/1b), convert the honour-system gate to machine enforcement across all repos (WS-2), discharge the derived-state debt question (WS-5), and open the four big arcs as ADRs + GitHub epics — without touching any breaking kernel code.

**Architecture:** Four independent task groups, each scoped to specific repos and producing its own PR(s): **A** Specs Truth (`layers/specs`), **B** Enforcement (all 7 hook-less repos), **C** Derived-state audit (`domains/exercir` + `domains/herdbook`, read-only investigation → workbench note), **D** Open the arcs (2 ADRs on `layers/specs` + ~7 GitHub epics). Groups B and C are independent and parallelizable; **Group D depends on Group A** (it needs the verified next-free ADR number to avoid collisions).

**Tech Stack:** Markdown + YAML frontmatter (ADR-181), POSIX `sh` git hooks + `core.hooksPath`, npm scripts, `node` ESM validator, `gh` CLI for issues, Prisma schema (read-only for the audit).

---

## Execution notes (read before starting any task)

- **Source-of-truth spec:** `docs/superpowers/specs/2026-06-04-substrate-coherence-remediation-program-design.md`. This plan implements only its §7 do-now set.
- **Repos are separate clones.** `layers/*` and `domains/*` are sibling git repos (gitignored from the workbench). Each task states its **working directory**; `cd` there (use absolute paths) before git operations.
- **PR-gated everywhere.** No direct-to-main, including docs/specs. Each group branches → commits → opens a PR. Run the repo's verifier wave before requesting merge.
- **Commit hygiene (critical):** the workbench and several repos carry unrelated untracked WIP. **Never `git add -A`.** Stage explicit paths only, and verify with `git status --short` before every commit.
- **Working language:** English for all identifiers/comments/commit messages (UI copy is the only i18n exception — not relevant here).
- **`gh` token caveat:** this token is repo + `write:packages` only (no `read:org`). `gh issue create` / `gh issue comment` **work**; `gh pr edit --title` and org-resolving GraphQL **fail**. Don't chain them.
- **Ground-truth-first:** the source evaluation was a point-in-time snapshot. Several "missing ADRs" may simply be ahead of a stale checkout. **Always establish current HEAD state before asserting a gap** (Task A1 exists for exactly this).
- **No breaking code this session.** If any task tempts you to modify a published contract/runtime surface, stop — that belongs to the `substrate@1.0` train (later sessions).

---

# GROUP A — Specs Truth (WS-1, WS-1b)

**Working directory:** `D:\development\projects\de-braighter\layers\specs`
**Branch:** `docs/specs-coherence-reconciliation`
**Produces:** one PR on `de-braighter/specs`.

### Task A1: Establish current ground truth (investigation, no changes)

**Files:** none modified. Output recorded in the PR description draft + this task's checkboxes.

- [ ] **Step 1: Sync and snapshot the repo**

Working dir `layers/specs`. Run:
```bash
git fetch origin && git status -sb && git log --oneline -8
```
Expected: a clean or known working tree on an up-to-date `main`. Record the current HEAD sha.

- [ ] **Step 2: Read the ADR index counters**

Read `adr/README.md`. Record the stated `next-free-adr` and `latest` values (the evaluation saw `next-free-adr: 205`, latest `ADR-204` — confirm or correct against HEAD).

- [ ] **Step 3: Determine the true status of each suspect ADR**

For each of ADR-196, 197, 198, 202, 203 — open the file, record its current `status:` frontmatter value. For each, find shipping evidence:
```bash
# example for ADR-197 (forRoot DB-auth wiring, shipped runtime 0.11.0):
git log --oneline --all -S "adr-197" -- . | head
```
Cross-check against the runtime CHANGELOG / published versions referenced in the ADR body. Record per ADR: `{current status, shipped? (Y/N + evidence: PR/commit/version)}`.

- [ ] **Step 4: Resolve the "missing" ADRs**

For each of ADR-205, 206, 207, 209 — check whether a file exists in current HEAD:
```bash
git ls-files adr/ | grep -E 'adr-(205|206|207|209)'
```
Record per number: `EXISTS (path)` or `ABSENT`. (Memory indicates 205/206/207 likely shipped and 209 may be a parallel-session artifact — verify, do not assume.)

- [ ] **Step 5: Record the findings table**

Write a findings table (markdown) capturing Steps 2–4 results. This table is the input to A2/A3 and goes into the PR description. **Do not flip any status yet.**

---

### Task A2: Flip shipped-but-`proposed` ADR statuses

**Files:** Modify (only those A1 proved shipped): `adr/adr-196-*.md`, `adr/adr-197-*.md`, `adr/adr-198-*.md`, `adr/adr-202-*.md`, `adr/adr-203-*.md` — frontmatter `status:` line.

- [ ] **Step 1: Flip status with citation**

For each ADR that A1 marked `shipped=Y` and `status: proposed`, change frontmatter to `status: accepted` and append a one-line provenance note in the ADR body's status/history section:
```markdown
> Status reconciled proposed → accepted on 2026-06-04: implementation shipped in <PR/commit/version from A1 Step 3>. (Substrate coherence remediation WS-1.)
```
Leave any ADR A1 could **not** prove shipped untouched (note it in the PR as "left proposed — no shipping evidence found").

- [ ] **Step 2: Verify frontmatter still conforms (ADR-181)**

Run the frontmatter validator (discover its invocation by reading `tools/validators/frontmatter-schema.mjs` — it may take a glob or run over `adr/`):
```bash
node tools/validators/frontmatter-schema.mjs
```
Expected: PASS (no schema errors on the edited files). If the validator needs file args, pass the edited files.

- [ ] **Step 3: Commit**

```bash
git add adr/adr-196-*.md adr/adr-197-*.md adr/adr-198-*.md adr/adr-202-*.md adr/adr-203-*.md
git status --short   # confirm ONLY intended files staged
git commit -m "docs(adr): reconcile shipped ADR statuses proposed -> accepted (WS-1)"
```

---

### Task A3: Reconcile the index counters + missing-ADR gaps

**Files:** Modify `adr/README.md`. Possibly create a gap-tracking note.

- [ ] **Step 1: Correct the index counters**

If A1 Step 4 found 205/206/207/209 EXIST but aren't indexed, add their rows to `adr/README.md` (title, status, link) and set `next-free-adr` to the true next free number (max existing + 1). If any are genuinely ABSENT, set `next-free-adr` past the highest existing number and record the ABSENT ones in Step 2.

- [ ] **Step 2: File gaps (only if any ADR is genuinely absent)**

For each genuinely-absent ADR number whose decision shipped (per A1), add a line to the PR description listing it as a documentation gap to backfill in a follow-up (do NOT author the missing ADR from scratch this session — it needs its real decision content). If none are absent, note "no gaps — all referenced ADRs present in HEAD."

- [ ] **Step 3: Verify + commit**

```bash
bash tools/lint-md.sh adr/README.md   # or the repo's md gate; discover exact invocation
git add adr/README.md
git status --short
git commit -m "docs(adr): reconcile ADR index counters with shipped reality (WS-1)"
```

---

### Task A4: WS-1b — tenant-model truth + minimality standing-review note

**Files:** Create `adr/notes/2026-06-04-kernel-minimality-standing-review.md` (or the repo's conventional notes location — discover by reading how existing notes are filed).

- [ ] **Step 1: Establish the tenant-model truth**

Read the substrate checkout to answer definitively: does `core.tenant` (or any tenant-enrollment table) exist, or is `tenant_pack_id` still a derived UUIDv5 hash with no stored row?
```bash
# from layers/substrate:
grep -rn "core.tenant\|tenant_pack_id" libs/substrate-runtime/prisma libs/substrate-runtime/src/tenant-registry 2>/dev/null | head -40
git -C ../substrate ls-files 'libs/substrate-runtime/prisma/**' | grep -i tenant
```
Record the truth: e.g. "tenant_pack_id is a deterministic UUIDv5(tenantId, packId) computed in `tenant-registry.ts`; no `core.tenant` enrollment table exists as of substrate-runtime <version>." Also confirm whether an `ADR-209` file exists (cross-check A1 Step 4).

- [ ] **Step 2: Write the standing-review note**

Create the note documenting two things future minimality reviews must revisit:
  1. **`kernel.mechanism`** — admitted ADR-190 build-ahead override; no second pack consumer yet; review trigger = "demand a second consumer or demote."
  2. **`LineageRepository` + `core.individual`/`core.lineage_edge`** — passes the ≥2-pack test (conservation + herdbook) but is the kernel's least four-concerns-native surface; review trigger = "if either breeding pack leaves, re-run the inclusion test."
  Plus the tenant-model truth from Step 1 (so the record is unambiguous about whether a stored tenant model exists).

- [ ] **Step 3: Verify + commit**

```bash
bash tools/lint-md.sh adr/notes/2026-06-04-kernel-minimality-standing-review.md
git add adr/notes/2026-06-04-kernel-minimality-standing-review.md
git status --short
git commit -m "docs(adr): tenant-model truth + kernel minimality standing-review note (WS-1b)"
```

---

### Task A5: Open the Group A PR

- [ ] **Step 1: Run the spec verifier gate**

Run the specs repo's local gate (markdownlint body gate + frontmatter validator + spec-auditor pass). Discover the exact command from the repo (likely `tools/lint-md.sh` over the corpus + the validator). Expected: PASS.

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin docs/specs-coherence-reconciliation
gh pr create --repo de-braighter/specs \
  --title "docs: specs↔shipped coherence reconciliation (WS-1/1b)" \
  --body "<paste the A1 findings table + summary of flips/index fixes/notes>

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans]
Effect: cycle-time 0.01±0.01 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
(Note: `gh pr create` works with this token; do not chain `gh pr edit`.)

---

# GROUP B — Enforcement: real gates in every repo (WS-2)

**Goal:** every code repo gets a committed `.githooks/pre-push` that runs a fast gate, auto-activated via an npm `prepare` script; `layers/specs` (no package.json) gets a hook that runs its lint + frontmatter validator.

**Reference pattern (read first):** `domains/devloop/.githooks/pre-push` is the proven pilot — read it before writing any hook. Mirror it.

**Repos to fix (7):** `domains/exercir`, `domains/herdbook`, `layers/substrate`, `layers/design-system`, `domains/markets`, `domains/conservation` (code repos), and `layers/specs` (docs repo, special case). `domains/devloop` already has the hook — skip it.

### Task B1: Define the canonical hook (reference task — produces the template, no repo change)

**Files:** none yet — this task fixes the exact content reused by B2/B3.

- [ ] **Step 1: Read the pilot**

Read `domains/devloop/.githooks/pre-push` and record the fast-gate command it uses (the evaluation reports typecheck + test). Read its activation mechanism (`git config core.hooksPath .githooks`, and whether a `prepare` script auto-sets it).

- [ ] **Step 2: Fix the canonical code-repo hook**

The committed `.githooks/pre-push` for code repos is exactly:
```sh
#!/bin/sh
# Pre-push fast gate. Propagated 2026-06-04 from domains/devloop (pilot) to close
# the honour-system-gate gap — substrate coherence remediation WS-2.
# Do NOT bypass with --no-verify (policies/git.md). The full ci:local + Sonar gate
# runs at PR/merge time; this is the cheap local backstop.
set -e
echo "[pre-push] running fast gate (npm run gate:prepush)…"
npm run gate:prepush
```

- [ ] **Step 3: Fix the activation contract**

Each code repo must (a) define `"gate:prepush"` in `package.json` scripts as that repo's fast gate, and (b) ensure `"prepare"` runs `git config core.hooksPath .githooks` (merge with any existing `prepare`). The fast gate is chosen per repo in B2 Step 2 — prefer existing `typecheck` + `test`; fall back to `lint` + `test`. **Never** make `gate:prepush` the full `ci:local` (too slow → invites `--no-verify`).

---

### Task B2: Apply the hook to each code repo (repeat per repo)

**Apply Steps 1–6 below independently for each of:** `domains/exercir`, `domains/herdbook`, `layers/substrate`, `layers/design-system`, `domains/markets`, `domains/conservation`. Each repo = its own branch `chore/prepush-gate` + its own PR.

- [ ] **Step 1: Branch in the target repo**

`cd` to the repo (absolute path). Run:
```bash
git fetch origin && git checkout -b chore/prepush-gate origin/main
```

- [ ] **Step 2: Discover the fast gate**

Read the repo's `package.json` `scripts`. Record which exist among: `typecheck`, `lint`, `test`, `ci:local`. Choose `gate:prepush` value: `npm run typecheck && npm run test` if both exist, else `npm run lint && npm run test`, else the lightest reliable combination present. Record the choice + why.

- [ ] **Step 3: Wire package.json**

Add to `scripts`: `"gate:prepush": "<chosen command from Step 2>"`. Ensure `prepare` exists and includes `git config core.hooksPath .githooks` (if a `prepare` already exists, append with ` && `). Note: if the repo uses `pnpm`, use `pnpm` invocations consistently in both the script and the hook (edit the hook's `npm run` → `pnpm run` for that repo).

- [ ] **Step 4: Create the hook + activate**

Create `.githooks/pre-push` with the canonical content from B1 Step 2 (swap `npm`→`pnpm` if applicable). Make it executable and activate now:
```bash
git update-index --chmod=+x .githooks/pre-push 2>/dev/null || true
git config core.hooksPath .githooks
```

- [ ] **Step 5: Verify the hook actually gates**

Prove it runs and blocks:
```bash
sh .githooks/pre-push; echo "exit=$?"
```
Expected: it runs the chosen gate and exits 0 on a green tree. Then prove it *blocks*: temporarily introduce a trivial failure the gate catches (e.g. a type error in a scratch file, or `npm run gate:prepush` with a broken test), re-run `sh .githooks/pre-push`, confirm **non-zero exit**, then revert the scratch break. Record both outcomes.

- [ ] **Step 6: Commit + PR**

```bash
git add .githooks/pre-push package.json
git status --short   # ONLY these two files
git commit -m "chore: add pre-push fast gate (WS-2 enforcement)"
git push -u origin chore/prepush-gate
gh pr create --repo de-braighter/<repo> \
  --title "chore: pre-push fast gate (WS-2)" \
  --body "Propagates the devloop pre-push pattern to close the honour-system-gate gap.
gate:prepush = <chosen command>. Verified: runs green, blocks on injected failure.

Producer: orchestrator/claude-opus-4-8 [writing-plans]
Effect: cycle-time 0.01±0.01 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

### Task B3: Apply the hook to `layers/specs` (special case — no package.json)

**Working directory:** `layers/specs`. **Branch:** `chore/prepush-gate`. (Can ride the Group A PR instead if Group A is still open — decide based on timing; if Group A merged, do a fresh branch.)

- [ ] **Step 1: Discover the validator + lint invocations**

Read `tools/validators/frontmatter-schema.mjs` and `tools/lint-md.sh` to learn exact invocation (args, target globs, exit codes).

- [ ] **Step 2: Create the specs hook**

Create `.githooks/pre-push`:
```sh
#!/bin/sh
# Pre-push gate for the specs corpus — substrate coherence remediation WS-2.
# Runs the markdown body gate + ADR-181 frontmatter validator. Do NOT bypass.
set -e
echo "[pre-push] markdown body gate…"
bash tools/lint-md.sh
echo "[pre-push] ADR-181 frontmatter validator…"
node tools/validators/frontmatter-schema.mjs
```
(Adjust the two command lines to the exact invocations found in Step 1.)

- [ ] **Step 3: Activation (no package.json → manual + documented)**

Activate now: `git config core.hooksPath .githooks`. Create `tools/install-hooks.sh`:
```sh
#!/bin/sh
# Run once per clone to activate the specs pre-push gate.
git config core.hooksPath .githooks && echo "specs pre-push hook activated."
```
Add a one-line pointer to it in `README.md` (or `CONTRIBUTING.md` if present): "Contributors: run `sh tools/install-hooks.sh` once after cloning."

- [ ] **Step 4: Verify**

```bash
sh .githooks/pre-push; echo "exit=$?"
```
Expected: runs both gates, exits 0 on the clean corpus. Inject a frontmatter violation in a scratch ADR copy, confirm non-zero, revert.

- [ ] **Step 5: Commit + PR**

```bash
git add .githooks/pre-push tools/install-hooks.sh README.md
git status --short
git commit -m "chore: pre-push gate wiring lint-md + ADR-181 validator (WS-2)"
git push -u origin chore/prepush-gate
gh pr create --repo de-braighter/specs --title "chore: specs pre-push gate (WS-2)" --body "Wires the previously-unwired frontmatter validator + md gate into a pre-push hook. Verified blocks on injected frontmatter violation.

Producer: orchestrator/claude-opus-4-8 [writing-plans]
Effect: cycle-time 0.01±0.01 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# GROUP C — Derived-state exception audit (WS-5)

**Goal:** classify every persisted derived-state table and write the crisp pack-side rule. Read-only investigation across two repos → one note in the workbench.

**Working directory for the write:** `D:\development\projects\de-braighter` (workbench, on the existing `docs/substrate-coherence-remediation` branch). Investigation reads `domains/exercir` + `domains/herdbook`.

### Task C1: Enumerate the exception tables (investigation)

**Files:** none modified.

- [ ] **Step 1: Find every annotated exception table**

```bash
grep -rn "ADR-176 exception\|Derived-snapshot" domains/exercir/prisma domains/herdbook/libs/herdbook-pack/prisma
```
Expected: the exercir player-self family + `player_trait_value` (`domains/exercir/prisma/packs/football.prisma`, ~lines 320–506) and herdbook `planned_mating` (`.../herdbook-pack/prisma/schema.prisma`, ~599–619). Record the full list with file:line.

- [ ] **Step 2: For each table, capture its generator status**

For each table, record: (a) what it's derived FROM (the generator: posterior, live kinship, weekly rollup, etc.), (b) whether that generator is currently wired and runnable, (c) whether the row is a point-in-time decision record (predicted-vs-actual matters) or a pure read-cache.

---

### Task C2: Classify + write the rule

**Files:** Create `docs/superpowers/notes/2026-06-04-derived-state-exception-audit.md` (workbench).

- [ ] **Step 1: Write the classification table**

One row per table: `{table, generator, generator-wired?, classification ∈ {snapshot/decision-record (keep), cache-in-disguise (convert when generator lands)}, retirement-trigger}`. Apply this test: a snapshot is legitimate iff it is EITHER a point-in-time decision record (e.g. `planned_mating.predicted_f` — drift vs `actualF` is the feature) OR a stand-in for an un-wired generator with a named trigger to retire it (e.g. `player_trait_value` "until the live trait generator lands"). Anything else is a cache-in-disguise and must be flagged.

- [ ] **Step 2: Write the pack-side rule**

Add the crisp rule, verbatim, for future packs:
> **Pack-side derived-state rule.** ADR-176 §4's prohibition on persisted derived state is *kernel-scoped*. A pack MAY persist a derived value in its own schema iff it is (a) a point-in-time decision record whose divergence from the live value is itself meaningful, OR (b) a temporary stand-in for a generator not yet wired, carrying a named retirement trigger. Every such table MUST carry a `// derived-snapshot (ADR-176 pack exception): <a|b>, retire-when: <trigger>` comment. A persisted value that is merely a faster read of a live generator is a cache-in-disguise and is **not** permitted.

- [ ] **Step 3: Propose ratification (don't sneak a convention in)**

Because this is a cluster-wide convention, do not treat the note as authoritative on its own. At the end of the note, add: "Proposed for ratification as an ADR amendment to ADR-176 — see issue <filled in Group D>." (The actual issue is created in D3.)

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-06-04-derived-state-exception-audit.md
git status --short
git commit -m "docs(note): derived-state exception audit + pack-side rule (WS-5)"
```

---

# GROUP D — Open the arcs (ADRs + GitHub epics)

**Depends on Group A** (needs the verified `next-free-adr` from Task A3). **Working directory for ADRs:** `layers/specs` (new branch `docs/open-1.0-arc-adrs` off the reconciled main, or stacked on Group A's branch if unmerged).

### Task D1: Author the WS-3 ADR — retire the legacy inference port

**Files:** Create `adr/adr-<N>-retire-legacy-inference-backbone-port.md` where `<N>` = next free number from A3. Use `templates/adr/` (workbench) or the specs ADR template as the structural base.

- [ ] **Step 1: Confirm the consumer blast radius**

```bash
grep -rn "INFERENCE_BACKBONE_PORT\|out-ports/inference" layers/substrate domains 2>/dev/null
```
Record every importer of the legacy `INFERENCE_BACKBONE_PORT` (distinct from the scoped `INFERENCE_BACKBONE`). This list goes in the ADR's Consequences.

- [ ] **Step 2: Write the ADR**

Required content:
  - **Context:** two parallel inference port stacks. Legacy `libs/substrate-contracts/src/out-ports/inference.port.ts` (`INFERENCE_BACKBONE_PORT`, 5 methods, no `counterfactual`, `PosteriorInput` has **no `tenantPackId`** — pre-ADR-205) vs scoped `libs/substrate-contracts/src/inference/inference-backbone.port.ts` (`INFERENCE_BACKBONE`, has `counterfactual`, requires `tenantPackId` per ADR-205). A consumer on the legacy port runs inference with no tenant scoping → **cross-tenant read hazard**. Duplicate `InferenceBackbone` symbol is a footgun.
  - **Decision:** deprecate the legacy port immediately (`@deprecated` + a bind-time deprecation log); **remove it in `substrate@1.0`**. The tenant-scoped `/inference` port becomes the single inference contract. All consumers from Step 1 migrate.
  - **Consequences:** breaking → rides the coordinated 1.0 train (with WS-6, WS-8); closes the tenancy hazard; consumer list from Step 1.
  - **Status:** `proposed`. Set `depends-on`/`relates-to` ADR-205, ADR-203.

- [ ] **Step 3: Verify frontmatter + commit**

```bash
node tools/validators/frontmatter-schema.mjs   # confirm new file conforms
git add adr/adr-<N>-retire-legacy-inference-backbone-port.md
git status --short
git commit -m "docs(adr): propose retiring legacy INFERENCE_BACKBONE_PORT (WS-3, 1.0)"
```

---

### Task D2: Author the WS-8 ADR — generalize the subject ontology

**Files:** Create `adr/adr-<N+1>-generalize-subject-ontology.md`.

- [ ] **Step 1: Capture the current workarounds**

```bash
grep -rn "kind: *'person'\|kind === 'person'\|as-person\|asset.*person" domains/markets domains/exercir layers/substrate 2>/dev/null
```
Record each `kind:'person'` guard/lie (expected: `domains/markets/apps/markets-api/src/readout/readout.service.ts:~47`; exercir's subject guard; the Normal-Normal fast-path gate in substrate). This is the ADR's evidence.

- [ ] **Step 2: Write the ADR**

Required content:
  - **Context:** conjugate fast-paths (Normal-Normal et al.) gate on `subject.kind === 'person'`, so non-person twins (markets assets, herdbook animals, devloop repos) must misrepresent their subject. Contradicts the domain-agnostic-kernel claim; pollutes consumers with workarounds (cite Step 1).
  - **Decision (direction; detailed shape designed in the WS-8 arc):** make `SubjectRef.kind` an open/extensible discriminator the inference fast-paths treat **opaquely** — conjugate selection keys off `conjugateHint` + the distribution family, **never** the subject kind. Remove all `kind:'person'` guards. Breaking contract change → **rides `substrate@1.0`**.
  - **Consequences:** breaking (`SubjectRef` + fast-path signatures); consumers drop their workarounds; enables non-person reproducibility subjects (WS-9).
  - **Status:** `proposed`. `relates-to` ADR-198 (subject/member resolution), ADR-205.

- [ ] **Step 3: Verify + commit + PR the ADRs**

```bash
node tools/validators/frontmatter-schema.mjs
git add adr/adr-<N+1>-generalize-subject-ontology.md
git status --short
git commit -m "docs(adr): propose subject-ontology generalization beyond kind:person (WS-8, 1.0)"
git push -u origin docs/open-1.0-arc-adrs
gh pr create --repo de-braighter/specs --title "docs(adr): open the substrate@1.0 arc — port retirement + subject ontology" --body "Two proposed ADRs opening the coordinated 1.0 breaking train (WS-3 + WS-8). FHIR eviction is already covered by ADR-204.

Producer: orchestrator/claude-opus-4-8 [writing-plans]
Effect: cycle-time 0.01±0.01 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

### Task D3: Create the GitHub epics

**Files:** none (creates issues). Run from anywhere. Verify the `type/epic` label exists per repo first; if `gh` errors on an unknown label, drop `--label` and note it in the body.

- [ ] **Step 1: Create the coordinating + per-arc epics**

Run each (substitute real ADR numbers from D1/D2 into the bodies). Each body must include: the WS id, the spec link, the done-when from the spec §4, and the dependency.

```bash
# Coordinating release epic
gh issue create --repo de-braighter/substrate \
  --title "[epic] substrate@1.0 — coordinated breaking release (WS-3 + WS-6 + WS-8)" \
  --body "Batches three breaking changes so consumers migrate once: legacy inference-port retirement (WS-3, ADR-<N>), FHIR eviction (WS-6, ADR-204), subject-ontology generalization (WS-8, ADR-<N+1>). Done-when: contracts+runtime 1.0 published with a single migration guide; exercir/herdbook/markets green on 1.0. Spec: docs/superpowers/specs/2026-06-04-substrate-coherence-remediation-program-design.md §5."

# WS-3
gh issue create --repo de-braighter/substrate \
  --title "[epic] WS-3 retire legacy INFERENCE_BACKBONE_PORT (1.0)" \
  --body "Remove the root out-ports inference port (no tenantPackId → cross-tenant read hazard). ADR-<N>. Done-when: only the tenant-scoped /inference port published; no consumer imports the legacy token. Rides #<coordinating epic>."

# WS-4
gh issue create --repo de-braighter/substrate \
  --title "[epic] WS-4 tenancy consistency: unify tenant_pack_id type + axis + RLS default" \
  --body "Resolve string-vs-UUID tenant_pack_id, the dual tenant axis (org vs pack), and RLS-on-by-default. Done-when: single documented tenant-id type + axis convention; migration path noted; conservation de-fork can adopt it. Depends on WS-1b tenant truth."

# WS-6
gh issue create --repo de-braighter/substrate \
  --title "[epic] WS-6 execute FHIR eviction (ADR-204) (1.0)" \
  --body "Physically move src/fhir/** to a health-pack; remove FHIR exports from substrate barrels; migrate pack-football. Done-when: zero FHIR symbols exported from runtime/contracts; pack-football green. Rides #<coordinating epic>."

# WS-7
gh issue create --repo de-braighter/conservation \
  --title "[epic] WS-7 de-fork conservation onto published substrate@1.0" \
  --body "Flip off the vendored conservation-{contracts,runtime} fork onto published substrate@1.0; migrate tenant_org_id→tenant_pack_id; move population/breeding_event/kinship_cache out of the kernel schema into pack territory. Resolves the deferred ADR-027 consume-vs-fork question. Depends on substrate@1.0 + WS-4."

# WS-8
gh issue create --repo de-braighter/substrate \
  --title "[epic] WS-8 generalize subject ontology beyond kind:'person' (1.0)" \
  --body "Open/extensible SubjectRef.kind treated opaquely by conjugate fast-paths; remove kind:'person' guards/lies. ADR-<N+1>. Done-when: a non-person subject runs a posterior with no workaround; markets drops the BTC-as-person hack. Rides #<coordinating epic>."

# WS-9 (homed on substrate as a kernel-concern proof; domain choice is its first task)
gh issue create --repo de-braighter/substrate \
  --title "[epic] WS-9 reproducibility proof — versioned catalog + run manifest + replay" \
  --body "Pick one domain (candidate: markets) and exercise concern #4 for real: versioned catalog + persisted run manifest + a replay that reproduces a historical posterior bit-for-bit. Done-when: one domain replays to reproduce a past inference. Depends on substrate@1.0; WS-8 if the subject is non-person. First task = choose the domain."

# WS-5 rule ratification (from Group C)
gh issue create --repo de-braighter/specs \
  --title "[decision] ratify pack-side derived-state rule as an ADR-176 amendment (WS-5)" \
  --body "Ratify the pack-side derived-state rule from docs/superpowers/notes/2026-06-04-derived-state-exception-audit.md as an amendment to ADR-176. Snapshot/decision-record + un-wired-generator-stand-in permitted with a named retirement trigger; cache-in-disguise forbidden."
```

- [ ] **Step 2: Record the created issue numbers**

Capture each new issue number from the `gh` output. These feed Task D4 and the cross-references (e.g. `#<coordinating epic>`).

---

### Task D4: Back-link the tracking into the program spec

**Files:** Modify `docs/superpowers/specs/2026-06-04-substrate-coherence-remediation-program-design.md` §9 (workbench, on `docs/substrate-coherence-remediation` branch).

- [ ] **Step 1: Add the issue/ADR references**

In §9, replace the generic "GitHub epics … per arc" prose with the concrete created issue numbers (from D3 Step 2) and the authored ADR numbers (from D1/D2). Add the WS-5 audit note path.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-04-substrate-coherence-remediation-program-design.md
git status --short
git commit -m "docs(spec): back-link created epics + ADR numbers into program tracking"
```

---

## Dependency & ordering summary

- **Group A** runs first (Task D needs A3's verified `next-free-adr`).
- **Group B** and **Group C** are fully independent — dispatch in parallel with A.
- **Group D** runs after A (uses real ADR numbers) and after C (D3 creates the WS-5 ratification issue the C2 note references).
- Each group opens its own PR(s) in its own repo; run that repo's verifier wave before merge.
- **Twin ritual (mandatory):** after each PR merges, run the devloop SDLC-twin ritual from `domains/devloop` — `npm run dev -- drain <repo#pr>` (after the wave), then `… backfill` + `… reconcile` (after merge). The `Producer:`/`Effect:` lines are already in every PR body above.

---

## Self-review (completed by plan author)

- **Spec coverage:** WS-1→A1/A2/A3·A5; WS-1b→A4; WS-2→B1/B2/B3; WS-5→C1/C2(+D3 ratification issue); WS-3 ADR→D1; WS-8 ADR→D2; epics WS-3/4/6/7/8/9→D3; tracking back-link→D4. The §7 do-now set is fully covered. The big-arc *execution* (WS-6/7/8/9 code, the 1.0 train) is correctly **out of scope** here (later plans) — matches spec §7.
- **Placeholder scan:** the only intentionally-deferred values are `<N>`/`<N+1>` (ADR numbers, resolved in A3 before D runs) and the per-repo `gate:prepush` command (resolved by reading each package.json in B2 Step 2) — both are investigation-gated with an explicit "how to resolve" step, not hidden TODOs. Hook script content, ADR decision content, and gh commands are given in full.
- **Type/name consistency:** `gate:prepush` (script) + `.githooks/pre-push` (hook) + `core.hooksPath` used identically across B1/B2/B3. `INFERENCE_BACKBONE_PORT` (legacy) vs `INFERENCE_BACKBONE` (scoped) named consistently in D1. `tenant_pack_id`/`tenant_org_id` consistent with the spec.
- **No breaking code:** every task is docs / git-config / issue-creation / read-only investigation. Confirmed.
