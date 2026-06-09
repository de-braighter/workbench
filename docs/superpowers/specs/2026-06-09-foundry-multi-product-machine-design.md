# The Foundry — fully automated multi-product machine (design)

**Date:** 2026-06-09
**Status:** Approved design (founder-validated section by section)
**Home:** new standalone repo `domains/foundry` + workbench skills/policies
**Companion evidence:** `docs/compare-workbenches-analysis.md` (concurrency ladder, Quartiermeister),
`docs/audit-2026-06-09-remediation.md` (the 7 AI-harness failure modes), `docs/ideas-inbox/`
(14 real dossiers awaiting ingestion), `.claude/skills/product-engine/` (the per-repo predecessor).

## 1. Purpose

Turn an idea **dossier** (concept markdowns, scratchpads, decks, SVG assets, frontend prototypes —
exactly what accumulates in `docs/ideas-inbox/`) into a shipped substrate-based product through an
AI-only build pipeline, with founder involvement reduced to **risk-tiered gates**. The machine lifts
the existing workbench (skills, verifier wave, devloop twin, `/new-domain`) rather than replacing it:
it adds the three missing pieces — **intake**, **collision-safe multi-session orchestration**, and a
**deterministic quality floor** — and connects them.

Quality-first is a design constraint, not a slogan: every stage has a named enforcement mechanism
(§5), and the machine's own operational exhaust feeds the devloop calibration loop so the quality
system improves with use.

## 2. Founder decisions (ratified in the brainstorming session)

| Decision | Choice |
| --- | --- |
| Human gates | **Adaptive by risk tier** (T0/T1/T2, §3) |
| Collision plane | **Rung 3 — build the claim MCP now** (vs. lock-dirs); the dispatcher and the collision guard are the same component |
| Quality model | **Deterministic floor + twin ceiling** — guardrail battery in every scaffold AND devloop calibration adapting the wave |
| Session spawn | **Hybrid** — the machine maintains the queue and emits ready-to-launch session prompts; the founder launches them. Full automation later = a conductor calling the same MCP |
| Control-plane home | **Standalone `domains/foundry`** — devloop stays pure measurement; foundry *emits* events to it |

## 3. Product lifecycle pipeline & risk tiers

Six stages; every product flows through all of them.

1. **Intake.** `/dossier-intake <path>` ingests a dossier zip/folder: extracts the idea essence,
   domain-model hints, UI-prototype artifacts, and market signal into a normalized **Dossier
   Record** with a canonical asset layout. Nothing is lost; everything becomes addressable.
2. **Assessment.** `/opportunity-brief` scores **substrate fit**: does the idea decompose into the
   four kernel concerns (plan tree / event log / inference / reproducibility)? Which existing packs
   and primitives does it reuse? Codifies the rubric already demonstrated in
   `docs/ideas-inbox/substrate_saas_opportunity_dossier/.../01_overview_and_scoring.md`.
   Output: **Opportunity Brief**.
3. **Charter — Gate 1 (all tiers).** Founder greenlights. The **Product Charter** fixes: name,
   **risk tier**, scope, what-NOT-to-build, quality plan, and gate schedule. The only universal gate.
4. **Build-path design.** The machine generates the full path: domain scaffold plan (`/new-domain`
   tiers), an epic ladder (herdbook E1…En style), ADR needs, UI-surface plan derived from the
   prototype artifacts, and the deterministic quality-battery config. Every epic is decomposed into
   **claimable work items with disjoint scopes** — disjointness is *designed here*, which is what
   makes parallel sessions safe at issue grain. Parallelizable lanes are marked explicitly.
   T1+: **Gate 2 (architecture approval)** on the architecture/ADR set before any code.
5. **Execution.** Items flow into the Foundry queue; sessions claim, build via existing skills,
   pass the deterministic floor + verifier wave, PR with the twin ritual, release the claim.
   Parallelism across products always; within a product, along the marked lanes.
6. **Ship — tier-gated.** Outward-facing actions (publish, deploy, announce) stop per tier policy.

### Risk tiers

| Tier | Examples | Gates | Quality parameters |
| --- | --- | --- | --- |
| **T0** prototype/demo | markets, gridiron | greenlight + ship | wave standard, auto-merge OK |
| **T1** product | herdbook, exercir | + architecture approval | wave + `deep` effort on kernel-touching items, mutation thresholds enforced |
| **T2** regulated | oncology (MDR Class IIb) | + every kernel-touching ADR + designer-first mandatory | full battery, RLS/tenancy proofs required, no auto-merge |

The tier is set in the charter and parameterizes everything downstream: wave composition, effort
defaults, mutation-test thresholds, proof obligations, merge policy.

## 4. Control plane — the `domains/foundry` MCP server

A Node/TypeScript repo containing the MCP server, a small persistent store, and a status surface.
Registered the same way as the existing `devloop-knowledge-graph` MCP (stdio, in workbench-root
`.claude` settings) so it is available to every session launched from the cluster root.

**Design stance (ADR-176 applied to the machine itself):** the server's logic stays minimal and
boring — claims are rows, transitions are events. Intelligence lives in the *callers* (skills decide
what to do); the server decides only **who may do it**.

### Data model

Event-sourced: append-only event log + derived state — deliberately the same shape as devloop's
event log so Foundry exhaust is directly ingestible by the twin.

- **Product** — key, charter ref, risk tier, repo, priority, stage.
- **WorkItem** — product, epic, scope (repo + GitHub issue + optional path-prefix), lane,
  dependencies, status, tier-derived quality obligations.
- **Claim** — work item, session id, worktree path, branch, TTL + heartbeat timestamps, outcome on
  release.
- **Gate** — product, gate type (greenlight / architecture / ADR / ship), payload ref,
  decision + timestamp.

### MCP tool surface (complete v1 — small on purpose)

| Tool | What it does |
| --- | --- |
| `foundry_status` | The board: products, in-flight claims, stale claims, gates awaiting the founder |
| `foundry_next` | Highest-value claimable item across products, honoring priorities, lanes, dependencies |
| `foundry_claim` / `foundry_heartbeat` / `foundry_release` / `foundry_handoff` | Atomic claim lifecycle; a claim is rejected if its scope overlaps an active claim |
| `foundry_session_prompt` | Generates N ready-to-paste session launch prompts for the top N disjoint items — the hybrid-spawn surface |
| `foundry_queue_push` | Build-path designer pushes epics/items here |
| `foundry_gate_request` / `foundry_gate_decide` | Founder gates as first-class auditable records, not chat messages |

### Claim protocol

- Claim at **session start** (atomic check-and-claim) — never at prompt-generation time; a generated
  prompt that is never launched must not hold a lock.
- Scope-overlap rejection at **issue grain**; disjointness was designed upstream (§3.4), so overlap
  logic stays trivial.
- Heartbeat on a cadence; TTL expiry → stale → reclaimable; the abandoned worktree is listed in
  `foundry_status` for cleanup.
- Every transition appends an event; a foundry → devloop export keeps the twin fed with
  claim/handoff/queue dynamics it cannot see from GitHub alone.

### What the server deliberately does NOT do

Spawn sessions (hybrid spawn — the founder launches), run quality gates (sessions do, locally),
make build decisions (skills do), or store knowledge (specs/KG do). Arbitration + queue + gates,
nothing else.

## 5. Session protocol & the quality system

### Session protocol (mandatory ritual, every working session)

1. **Boot** — `foundry_claim` for the item (the launch prompt embeds the item id; the claim happens
   atomically at session start).
2. **Isolate** — create a git worktree for the claim. **No session ever works in the shared
   clone.** Closes the shared-working-tree wound structurally: no two sessions share a checkout.
3. **Execute** — delegate by item type to the existing skill arsenal
   (subagent-driven-development for plan execution, designer-first for risky items per tier, …).
   The Foundry adds no new way to build — it routes to what already works.
4. **Quality** — deterministic floor locally (below), then the verifier wave per tier;
   `post-findings` before merge.
5. **Land** — PR with `Producer:` / `Effort:` / `Effect:` lines; merge per tier policy; twin ritual
   (drain → backfill → reconcile).
6. **Release** — `foundry_release` with outcome; worktree removed.

Crash recovery is structural: heartbeat TTL → stale claim → reclaim; orphaned worktrees surface in
`foundry_status`.

### Quality floor (deterministic battery)

Packaged once in the foundation layer (`@de-braighter/lint-kit` / `@de-braighter/test-kit`
extensions) and wired into `/new-domain` so **every product is born with it**; existing repos are
retrofitted progressively. Contents, each mapped to the failure mode it kills:

| Guardrail | Kills |
| --- | --- |
| Mutation testing (Stryker), tier-based thresholds | test-theater |
| knip (dead exports / unused deps) | speculative generality |
| ESLint switch-exhaustiveness + the audit lint set | unmapped-error→500 |
| Testcontainers under a **non-superuser role** | broken-but-passing RLS/tenancy primitives |
| a11y battery for UI tiers (canonical patterns from the player-surfaces arc) | inaccessible-by-default UI |
| Coverage delta + local Sonar (as today) | silent coverage erosion |

### Quality ceiling (adaptive)

- The seven audit failure modes become explicit checklists in the `reviewer` / `qa-engineer` agent
  prompts (test-theater, lying comments, non-atomic security ops, isolation-untested-by-default, …).
- devloop's per-verifier **precision** readout (the PR-findings arc) feeds back into wave
  composition per repo: verifiers that don't catch real issues in a given repo get replaced or
  re-prompted. Quality is enforced by the floor and *learned* by the ceiling.

## 6. Decomposition & build order

Six sub-projects, each with its own spec → plan → build cycle:

| # | Sub-project | What ships | Depends on |
| --- | --- | --- | --- |
| **F1** | Foundry control plane | `domains/foundry` repo, MCP server, store, status board | — |
| **F2** | Session protocol | boot/claim skill, worktree mandate in `policies/git.md`, prompt templates | F1 |
| **F3** | Intake & charter | `/dossier-intake`, `/opportunity-brief` skills, charter template, tier policy | — (file-backed first, Foundry-backed once F1 lands) |
| **F4** | Build-path designer | charter → epic ladder → disjoint claimable items → `foundry_queue_push` | F1, F3 |
| **F5** | Quality floor battery | lint-kit/test-kit extensions, `/new-domain` upgrade, audit checklists into verifier agents | — (fully parallel) |
| **F6** | Twin integration | foundry-events → devloop export, wave-composition feedback | F1, devloop |

**Build order:** F1 → F2 (the spine), with F3 and F5 in parallel from day one (both independent),
then F4, then F6.

**First end-to-end proof:** take one real dossier from `docs/ideas-inbox/` (e.g. Agricultural
Ecosystem Twin) through intake → charter → build-path → one claimed work item executed under the
full protocol, with the deterministic floor green and the twin ritual run.

## 7. Error handling & failure stances

- **Stale claims** — TTL + heartbeat; reclaim is explicit (`foundry_next` surfaces stale items with
  their abandoned worktree path); no silent takeover.
- **Store corruption / unavailable MCP** — sessions refuse to claim and fall back to read-only work
  (the protocol fails closed; nobody works unclaimed).
- **Gate deadlock** — gates awaiting the founder are surfaced in `foundry_status` and never block
  *other* products' lanes.
- **Disjointness violations discovered mid-build** (two items turn out to touch the same file) —
  the session holding the older claim proceeds; the newer claim is handed back via
  `foundry_handoff` with a note, and the build-path designer's lane map is corrected.
- **Quality-floor failures** — never bypassed; a session that cannot get the floor green releases
  the claim with outcome `blocked` and the item re-enters the queue with the failure attached.

## 8. Testing strategy

- **F1:** claim-protocol unit tests (atomicity, overlap rejection, TTL/stale-reclaim) +
  MCP-contract tests; concurrency tests with simulated parallel claimers.
- **F2–F4:** skill-level dry runs against fixture dossiers (the 14 real ones in `ideas-inbox` are
  the fixture corpus).
- **F5:** the battery proves itself on one existing repo (run the mutation/knip/RLS-role gates on
  `domains/devloop` or `domains/conservation` and triage the findings) before becoming a default.
- **End-to-end:** the §6 first-proof run is the acceptance test for the machine as a whole.

## 9. What this design deliberately defers

- **Conductor daemon** (auto-spawning sessions) — the hybrid-spawn MCP surface is conductor-ready;
  building the daemon is a separate future decision.
- **Cross-machine sessions** — the claim server makes this possible later; v1 assumes one machine.
- **Foundry-as-product** (selling the machine) — same stance as substrate: internal infrastructure,
  substrate hygiene without substrate ambition.
- **Modeling the Foundry as a substrate pack** (build path = plan tree, SDLC events = event log,
  calibration = inference) — a beautiful dogfood story, noted as a north-star alignment; v1 uses a
  plain event log + derived state.
