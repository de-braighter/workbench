# Next-session prompt — Foundry fuller-vision grind (P1→P3)

> Paste the block below into a fresh Claude Code session launched from `de-braighter/`.
> It continues the (now-complete) autonomous Foundry ladder into the fuller-vision gaps the
> completeness-critic queued. Same SDLC discipline, same guardrails. Self-contained + recoverable.

---

Autonomously close the gap from Foundry's "falsifiable DONE" to **fully-on-substrate** by grinding the
fuller-vision slices **P1→P3** (plus P4 as P3's gate) through our normal SDLC (brainstorm → design spec +
ADR → writing-plans → subagent-driven-development → verifier wave + opus whole-branch review → PR-per-repo
→ twin ritual). Build the **ROLLS ROYCE** end state (complete, high-quality — not minimal MVPs) via the
SAME discipline: every increment is a thinnest-falsifiable, ADR-176-checked, reversible slice with an
acid test that **BITES** (independently-authored fixtures + a mutation that flips RED + a negative
control + a whole-branch opus review — per-task reviews are blind to cross-cutting defects). **Default
ZERO kernel change** — a kernel change ONLY via the ADR-176 inclusion-test + substrate-architect
designer-first ADR + charter-checker COHERENT path (see AUTONOMY). Run LEAN: you are a COORDINATOR that
delegates aggressively to subagents and holds only the stage map, the ledger, and conclusions. **Full
autogrind: decide-and-report, do NOT pause**; the brakes are the principled boundaries in AUTONOMY.

CONTEXT DISCIPLINE (lean orchestrator — delegate aggressively, keep your own context small):
  • You coordinate; subagents do. Delegate EVERYTHING context-heavy: codebase exploration (the Explore
    agent — returns conclusions not file dumps), ALL implementation (implementer subagents), ALL review
    (reviewer / charter-checker / qa-engineer / spec-auditor), spec/ADR drafting (designer /
    substrate-architect). You hold the STAGE MAP + ledger + CONCLUSIONS — never file contents or full diffs.
  • Hand artifacts as FILES under `domains/foundry/.git/sdd/` (task-brief / review-package scripts; reports
    to files). Subagent final messages return CONCLUSIONS ONLY (status + short SHA + 1-line test summary +
    concerns). One dispatch = ONE task; never paste accumulated history into later dispatches.
  • Run independent searches/reviews in PARALLEL (one message, multiple subagents).
  • **Checkpoint to `domains/foundry/.git/sdd/progress.md` after every task/merge** so any compaction is
    fully recoverable from the ledger + git, never from memory. After a compaction, trust the ledger +
    `git log` over recollection.

STATE RIGHT NOW — the Foundry autonomous ladder (Stages 0–5) is COMPLETE + MERGED, charter COHERENT
throughout, ZERO kernel change end-to-end:
  • foundry main @ `ccc489c` · devloop @ `9bcb496` · specs @ `20f9233` · workbench @ `91a5d47`. All clean
    (single worktree each, no stray branches).
  • Shipped: ADR-244 (conductor drives plan tree) · ADR-245 (ONE canonical log, devloop absorbed) ·
    ADR-246/247 (planFrontierAll sole driver, queue shadow retired) · ADR-248 (blueprint EXTRACTION) ·
    ADR-249 (blueprint GENERATION, generate∘extract identity) · ADR-250 (multi-target COMPILER — a
    blueprint compiles to ≥2 targets: test-harness + render-tree). foundry suite 309 green.
  • Recovery ledger (AUTHORITATIVE): `domains/foundry/.git/sdd/progress.md` — full ladder history + the
    "COMPLETENESS-CRITIC" gap list + the "NEXT-SESSION HANDOFF" block with per-slice KEY FACTS.
  FIRST ACTION: verify LIVE (delegate if it would bloat context) — `git -C domains/foundry log --oneline -3`
  (expect `ccc489c` on `main`); `git -C domains/foundry worktree list` (must be ONE; clean any
  `worktree-agent-*` orphan first); `cd domains/foundry && npx vitest run` (expect ~309 green); read the
  ledger's HANDOFF + COMPLETENESS-CRITIC sections. Trust ledger + git over any narrative.

READ FIRST (delegate the reading — have an Explore/general subagent digest these into a lean brief):
  • memory `foundry-substrate-self-application-arc.md` (the whole ladder + codebase facts + the recurring
    lessons); the ledger HANDOFF block (per-slice key facts for P1–P4).
  • The Stage 3/4/5 design specs in workbench `docs/superpowers/specs/2026-06-18-foundry-v1-stage{3,4,5}-*`
    (their "Deferred" sections name P1/P3/P4 precisely) + the relevant ADRs (242 derived substance, 248
    extraction, 249 generation, 250 compiler, 240 two-trees, 176 inclusion test, 243 agnosticism).

THE SLICES — grind in order; each = a full SDLC cycle, LANDED (PR merged + twin ritual) before the next:

  **P1 — yields-in-log** (highest leverage; pack-level, ADR-176 NOT triggered). TODAY yields
  (`SubstanceRef {kind:'pack'|'board'|'policy'|'indicator', id}`) ride on authored `CascadeNodeSpec`
  metadata, NOT the event log — so GENERATED products (and any log-only product) get an EMPTY substance
  face, breaking the ADR-242 "generated product is a first-class substrate product" claim. Thinnest slice:
  add an OPTIONAL `yields[]` field to the `foundry:WorkItemQueued` payload (backward-compatible — existing
  events have none); make `/build-path` AND `blueprintToEvents` (Stage 4, currently yield-free) emit yields;
  add `deriveSubstanceFromLog(state, productKey)` (⋃ yields of done items, log-derived); let
  `extractBlueprint` source substance from the LOG. Acid test BITES: a product generated via
  `blueprintToEvents` (carrying yields) → fold → `extractBlueprint` (log-only) → substance is NON-empty and
  equals the source's; a real generated product (agri) gains substance; a mutation (drop a yield) flips RED.

  **P2 — MCP surface completeness** (pack-level; zero arch risk). Only `foundry_generate_from_blueprint`
  is exposed. Add `foundry_extract_blueprint(productKey)` + `foundry_compile_blueprint(blueprintJson,
  targetId)` MCP tools (thin wrappers over `extractBlueprint` + the `CompileTarget` registry). Acid test:
  the extract→generate→compile pivot round-trips entirely through MCP tools (no internal-API calls).

  **P4 — concurrent-writer safety on the canonical log** (pack-level; DO BEFORE P3). `src/log.ts` appends
  via `appendFileSync` to the ONE shared canonical log (foundry conductor + devloop CLI both write). Low
  frequency masks races today; P3 (self-event-sourcing) increases concurrent writes — a torn append
  corrupts the single source of truth for the twin AND the compiler. Slice: a single-writer serialization
  (OS advisory file-lock or write-queue) around the append. Acid test: a concurrent-append stress test
  produces no torn/interleaved line; replay stays bit-stable.

  **P3 — foundry self-event-sourcing** (pack-level; GATE on P4). `FOUNDRY_PRODUCT`'s status is
  hand-annotated (`meta.status:'done'`), NOT log-derived; foundry was never queue-registered (Phase A/B
  shipped via PRs, not `foundry_claim`/`record_merge`) — so the conductor can't drive foundry's OWN ladder
  off `planFrontierAll`, and "foundry is self-applicable" holds logically but not operationally. Slice:
  event-source `FOUNDRY_PRODUCT` items (emit `WorkItemQueued` + record claim/merge through the existing MCP
  surface) so `treeFromQueue('foundry')` derives the live tree and `planFrontierAll` drives foundry itself;
  the hand-authored code tree becomes a bootstrap fixture only. Acid test: foundry's frontier is
  log-derived (NOT hand-annotated) — folding the log yields the correct claimable set for foundry; the
  conductor can claim a foundry work-item; a mutation (a stale annotation) no longer affects the frontier.
  CAUTION: this closes the foundry-builds-foundry loop — once P3 lands, foundry's OWN future slices become
  `foundry_queue_push`-able (until then, do NOT try to queue foundry's own work — it's blocked).

  DEFER (NOT in this grind — note as next-next): P5 hierarchical↔flat tree reconciliation (depends P1) ·
  P6 scheduled-wake actuation · P7 **live browser-runtime** target (button=intervention; may introduce an
  `InterventionDescriptor` kernel contract → MUST go via the AUTONOMY (1) ADR-176 + substrate-architect +
  charter path) · P8 Slice-1B devloop repo retirement (gate P4).

HOW (our way): per slice — superpowers:brainstorming (thinnest falsifiable increment; AskUserQuestion ONLY
  on a fork that genuinely changes the build) → design spec + ADR(s) (reserve the next ADR number
  atomically — 251 is free; +1 the `adr/adrs-by-tier.md` Design-local count; status enum is
  {proposed, ratified, superseded}; ADR body must pass `tools/lint-md.sh` — tag code fences ```text, use
  `-` bullets) → superpowers:writing-plans → superpowers:subagent-driven-development (fresh implementer per
  task; per-task spec+quality review; fix loop) → verifier wave (local-ci + reviewer + charter-checker +
  qa-engineer) → **whole-branch opus review on the final diff** → PR per repo → twin ritual. All of this is
  subagent work — you orchestrate. Least-capable-sufficient model per subagent.

GUARDRAILS / TRAPS (carry these — each cost real time this past arc):
  • KERNEL MINIMALITY (ADR-176): default zero kernel change. P1–P4 are ALL pack-level (event-payload
    extension, MCP wrappers, a file lock, pack event-sourcing) — none trips the inclusion test. A kernel
    change is permitted ONLY via the inclusion-test + substrate-architect designer-first ADR +
    charter-checker COHERENT (AUTONOMY (1)). charter-checker on EVERY kernel/pack PR regardless.
  • ACID TESTS MUST BITE — the opus WHOLE-BRANCH review repeatedly caught what per-task reviews missed:
    *vacuous/tautological* assertions (`f(X)===f(X)`), *weak-vs-strong* identity claims, *lying comments*,
    and *cross-cutting correctness gaps* (a stale `meta.productKey`). Always: independently-authored
    fixtures + a mutation that flips RED + a negative control + the opus whole-branch pass on the final diff.
  • WINDOWS/GIT: CWD drifts after `cd` — ALWAYS use absolute `git -C <repo>` paths. NEVER `git add -A` in
    the workbench (it carries unrelated untracked WIP) — explicit paths. `extract-vocabs.mjs` in
    domains/foundry is NOT yours. foundry/devloop use tsx/vitest directly (`npx vitest run` is bash-free).
  • SIBLING-REPO STALE LOCAL MAIN: a sibling repo's LOCAL main can lag origin (Stage-0's twin ritual only
    ff'd foundry+specs, not devloop, and it cost a mis-based branch + rebase). Before branching ANY repo:
    `git -C <repo> fetch origin main && git -C <repo> checkout main && git -C <repo> merge --ff-only
    origin/main`, THEN branch. (CHECK DEVLOOP especially if any slice touches it.)
  • WORKTREE STRAND: subagent fixers/wave-agents may strand a commit on a `worktree-agent-*` branch. Run
    implementers in the MAIN clone on the prepared branch (NOT isolation:worktree) for sequential chains;
    forbid wave agents from git mutations in shared clones; after a fixer, verify the real branch HEAD +
    `git worktree list` + clean orphans.
  • DEVLOOP-CLI / TWIN RITUAL (MANDATORY after EVERY merge): `drain <repo#pr>` (PR-scope verdicts; before
    merge) → `gh pr merge N --repo de-braighter/<repo> --squash` → `backfill <OWNER/REPO>` (plain
    OWNER/REPO, NON-IDEMPOTENT — once per repo) → `reconcile <repo#pr>`; for the foundry PR also `reviews
    de-braighter/foundry` + `resolve-findings de-braighter/foundry`. Do NOT run `ritual:post-merge` (it
    re-runs backfill + the deleted ingest-foundry). post-findings BEFORE merge; severity enum =
    `blocking|should-fix|nit|note`; file-level `path` 422s on a merged PR (embed path in text).
  • PR conventions: `gh pr comment N --repo <org>/<repo>` (NOT `<org>/<repo>#N`). Carry `Producer:
    orchestrator/claude-opus-4-8 [subagent-driven-development]` + `Effort: deep` + (foundry, self-observing)
    `Effect: cycle-time 0.01±0.01 expert` on each PR body. Never bypass pre-push hooks (the local gate).
  • Design-system dependency (if a slice needs a presentation type): foundry consumes
    `@de-braighter/design-system-core` as a TYPE-only **devDependency** (ADR-240 — presentation types live
    in design-system, never substrate-contracts). It resolved fine from GitHub Packages this arc.

AUTONOMY / ESCALATION: FULL autonomy — decide-and-report, never pause; RECORD every load-bearing decision
  (ledger + arc memory + PR body). (1) KERNEL CHANGE — default zero; permitted ONLY when the ADR-176
  inclusion test GENUINELY passes (one of the four kernel concerns AND ≥2 packs need it as shared infra the
  kernel must validate/query/version), via substrate-architect designer-first + a ratified ADR +
  charter-checker COHERENT; else it's pack work — do that. (2) EXTERNAL POSITIONING — build internally,
  never publish/market/position the substrate externally (Option-A business stance). (3) NEW PRODUCTS —
  stay on the foundry-on-substrate target; throwaway fixtures for acid tests are fine; a real new domain
  is a separate arc (propose in the ledger, don't sprawl). Everything else: grind to the Rolls-Royce end
  state. The verifier wave + whole-branch opus review remain the merge gate.

DONE (this grind): GENERATED products carry a substance face (yields flow through the log, P1);
  extract/generate/compile are all usable via MCP tools (P2); the canonical log is concurrent-write-safe
  (P4); foundry is SELF-event-sourced and the conductor drives foundry's OWN ladder off `planFrontierAll`
  (P3) — each landed PR-per-repo + twin ritual, charter-checker COHERENT throughout, kernel changes only
  via the AUTONOMY (1) path. Update the `foundry-substrate-self-application-arc` memory + the
  `domains/foundry/.git/sdd/progress.md` ledger as each slice lands. At grind's end, run a
  completeness-critic pass and queue the remaining gaps (P5–P8) as next slices.
