# Comparing three agentic workbenches — and synthesizing the ideal one

> Companion to `docs/compare-workbenches-prompt.md`. Generated 2026-06-02 by fanning out one
> read-only profiler per workbench (TAPAS, MDP, de-braighter), then synthesizing. Every claim is
> backed by a `path:line` citation drawn from the profiles; prior context was treated as a hypothesis
> to confirm, not fact. `D:\work\*` (TAPAS, MDP) was profiled factually, **not** conformance-checked
> against de-braighter standards.

## TL;DR — three workbenches, three different hardest problems

The single most important finding: **these are not three attempts at the same design that can be
ranked 1‑2‑3.** Each optimizes for a *different* dominant constraint, and its crown jewel is the
answer to *its* hardest problem:

| Workbench | Dominant constraint | Crown jewel |
|---|---|---|
| **TAPAS** | **Many AI *tools*** (Copilot-in-IDE + Claude Code + OpenCode) | A schema-validated instruction **compiler** (`ai-instructions/` → `transform.mjs` → per-tool bundles) with a **tool-aware distribution rule** (ADR-021) |
| **MDP** | **Many concurrent agent *sessions*** | **Quartiermeister** — an MCP control-plane server that **atomically rejects scope overlaps** so parallel sessions cannot race |
| **de-braighter** | **One tool + a *platform* to govern** | A **single-source, zero-replication** control plane + an **enforced kernel-minimality constitution** (charter-checker) + a **dogfooded SDLC twin** (devloop) |

Because the dominant constraints differ, **the ideal design is parameterized, not unioned.** The
synthesis below names the genuine forks (single-tool vs multi-tool; low vs high agent concurrency;
published-packages vs shared-libs vs no-shared-code; platform-governance vs app-governance) and makes
a reasoned call for each — saying what you give up.

## Who actually works where (this drives every recommendation)

| | TAPAS | MDP | de-braighter |
|---|---|---|---|
| **Org / setting** | Swiss Post, team | Swiss Post (military DB), team | Small team / solo, independent |
| **Primary tool(s)** | Copilot **and** Claude Code **and** OpenCode | Claude Code **and** OpenCode (Copilot = review gate only) | Claude Code **only** |
| **Work locus** | `cd` into siblings *and* root | `cd` into siblings (commits land in sub-repos) | **launch from root**, work the cluster |
| **Concurrency** | normal | **many parallel agent sessions** (first-class) | low (worktree isolation) |
| **Issue tracker** | Jira (`ATTP-NNN`) | Jira + Xray (`MDP-NNN`) | GitHub issues + the devloop twin |
| **Building a platform?** | No (an app) | No (an app) | **Yes** (the substrate kernel *is* the product) |

The reason TAPAS needs a compiler and de-braighter does not is entirely in row 2: **if Copilot is in
your toolchain you are forced to put config inside each repo** (it is repo-rooted and cannot walk up);
if you are Claude-Code-only, the walk-up tool finds one root config and replication is pure drift cost.
Neither is "more advanced" — they are correct answers to different toolchains.

## Deliverable 1 — Comparison matrix

Each cell is a short, evidenced characterization (`†` = documentary only, not file-proven; `~stale` =
artifact lags reality).

| Dimension | TAPAS | MDP | de-braighter |
|---|---|---|---|
| **Optimizes for** | Many AI tools | Many concurrent agent sessions | One tool + platform governance |
| **Sibling mechanism** | Gitignored nested clones, own `.git`, **not** submodules (`.gitignore:15-20`) | Gitignored nested clones, own `.git`, **not** submodules; no `.gitmodules` (`.gitignore:1-4`) | Gitignored nested clones, own `.git`, **not** submodules; no `.gitmodules` (`.gitignore:2-10`) |
| **Grouping** | Role clusters `specs/ services/ platform/ qa/` (`README.md:27-34`) | Pipeline stages + `implementation/ transition/` for clones (`README.md:16-28`) | `layers/ domains/ attic/` (`CLAUDE.md:35-57`) |
| **Tracked vs hosted** | Tracks control plane; hosts clones, `.mcp.json`, `CLAUDE.md`, transform output (`.gitignore:15-43`) | Tracks docs/stories/tests/tooling; hosts clones, junctioned skills, MCP store (`.gitignore:1-78`) | Tracks `.claude/{agents,skills}`+policies/templates/workflows/docs; hosts clones+secrets (`.gitignore:2-37`) |
| **Repo manifest** | `tapas-repos.yaml` w/ schema + repo **roles** (`...tapas-repos.yaml:5,14-35`) `~stale` (lists r2d/pergamum that don't exist) | **Markdown table only** — no YAML manifest (`README.md:35-40`) | `repos.yaml` (`repos.yaml:1,10-19`) `~stale` (missing `herdbook`) |
| **Control-plane location** | Compiled source `ai-instructions/` (5 src files) → per-tool bundles (`schema.yaml:1-122`) | Single canonical `AGENTS.md`, consumed in place; skills shared by **junction** (`AGENTS.md:193-217`) | Single-source at **root only**: 23 agents + 38 skills (`CLAUDE.md:35-44`) |
| **Agent-context distribution** | **Transform** emits Copilot/Claude/OpenCode bundles; **ADR-021**: walk-up tools get root only, Copilot gets per-repo (`transform.mjs:79-84`; `ADR-021:33-62`) | No transform; one `AGENTS.md` + Windows directory **junctions** for skills into `.claude/`+`.opencode/` (`AGENTS.md:201-209`) | **No transform, no replication**; launch-from-root so root `.claude/` applies cluster-wide (`README.md:10`, `CLAUDE.md:12`) |
| **Multi-tool support** | **Copilot + Claude + OpenCode** (first-class, all generated) (`copilot.mjs`/`claude.mjs`/schema) | **Claude + OpenCode** paired; Copilot = review gate (`AGENTS.md:119-123,193`) | **Claude Code only** (no `.cursor`/`.opencode`/copilot/ai-instructions) |
| **Multi-agent concurrency** | normal (no special infra) | **Quartiermeister MCP**: atomic scope-overlap rejection, claim/heartbeat/handoff, 16 tools (`quartiermeister/README.md:1-2,60-63`; `AGENTS.md:93-104`) | git **worktrees** (verifiers `isolation:"worktree"`); no claim arbitration (`verifier-wave.md:30-40`) |
| **Dependency strategy** | Relative paths (docs) + shared **Maven** libs via artifact repo + **version matrix** `dependency-map.json` + auto-bump PRs (`ishtar/pom.xml:6-11,27-28`; `dependency-map.json:1-32`) | **Polyglot, per-repo, no shared internal packages**; coupling by REST contract + frontend-bump workflow (`pom.xml`, frontend `package.json`) | **Published `@de-braighter/*` packages** to GitHub Packages; per-consumer caret pins → **version skew** (`adr-027`; `.npmrc:13`; exercir `package.json:45-46`) |
| **Governance depth** | ADRs + single `pr-review` stage + `check-conventions`; **no charter** | ADRs + **self-testing greppable** ADR-compliance + Copilot-review merge gate; **no charter** (`check-adr-compliance.sh:9-30`) | **Charter-checker** constitution + **4-agent parallel verifier wave** + designer-first (`charter-checker.md:3,37-57`; `verifier-wave.md`) |
| **ADR homing** | **Split**: repo `decisions/` (ADR-010..016) **+** Confluence space (ADR-029..039) — not reconciled (`ADR-020:41-42`) `~stale` | Single dir, **24 ADRs**, lifecycle + immutability (`adr/README.md:29-46`) | Single repo, **201 ADRs**, **frontmatter governance** (ADR-181) + spec-auditor (`adr-027:1-9`) |
| **PR gating** | Siblings PR-gated†; workbench `main` open (`ADR-020:88-90`) | Siblings PR-gated (gate lives in sub-repos' `.github`); workbench docs-lint only (`pr-review.yaml:16-18`) | **PR-gated everywhere incl. specs/ADRs**; never `--no-verify` (`policies/git.md:9-10,37-40`) |
| **SDLC tracking** | **Jira** (`ATTP-NNN`); plan lives in Jira, not a repo (`primer:41-42`) | **Jira + Xray** (`MDP-NNN`); generated `WORK-QUEUE.md` snapshot (`WORK-QUEUE.md:6-9`) | **GitHub issues** + dogfooded **SDLC twin** (`Producer:`/`Effect:` → devloop) (`policies/git.md:50-88`) |
| **Conceptual model** | **r2d two-pole**: expected(`specs`) / current(`devops`) / **derived** delta + Jira plan (`primer:35-42`) | **Pipeline-as-directory-spine** + Quartiermeister coordination kernel (`adr/README.md:7-17`) | **Substrate kernel**: 4 concerns + ADR-176 inclusion test + rings + "store generators, derive graphs" + twin posterior (`adr-176`; north-star `:343-345`) |
| **Least-obvious win** | Matched **distribution strategy to each tool's discovery model** (compile, then *stop* over-distributing) | Made **multi-agent concurrency enforced infra**, not a stale markdown lock-file | **Single-source plane + constitution-with-teeth + self-observing delivery** |

## Deliverable 2 — Per-dimension synthesis

For each axis: who wins, *why*, the recommended unified choice, and **the trade-off you accept**.
The four "forks" come first (real conflicts); then the axes where the three mostly converge.

### Fork 1 — Agent-context distribution (the central axis)

**The three answers.** TAPAS *compiles* one provider-agnostic source into per-tool bundles and, per
ADR-021, distributes them **by each tool's discovery model**: walk-up tools (Claude Code, OpenCode)
read the root config from any nested sibling, so they get **no** per-sibling copy; Copilot is
repo-rooted and workbench-blind, so it gets a per-repo `.github/copilot-instructions.md`
(`transform.mjs:79-84`; `ADR-021:33-62`). MDP keeps **one canonical `AGENTS.md`** consumed in place by
both its tools and shares *skills* via Windows directory junctions — no compile step
(`AGENTS.md:193-217`). de-braighter keeps everything **single-source at the root** and forbids
launching elsewhere, so there is nothing to distribute (`README.md:10`; `CLAUDE.md:12`).

**Who wins — conditional on toolchain.** This is the fork the prompt explicitly says *not* to
homogenize. The honest call:

- **Claude-Code-only (or any all-walk-up toolchain)** → **de-braighter wins.** Single-source,
  zero-replication, launch-from-root is the simplest correct design. A transform would be machinery
  with no payload to carry.
- **Any toolchain that includes Copilot (repo-rooted)** → **TAPAS wins.** You are *forced* to put a
  file in each repo; the only question is whether you hand-maintain it (drift) or generate it
  (TAPAS's transform). Generate it.

**Unified choice.** A **provider-agnostic `AGENTS.md` as the canonical source**, consumed in place by
walk-up tools (zero replication — de-braighter's instinct), **plus a thin transform that emits per-repo
config *only* for repo-rooted tools, and defaults to emitting nothing for walk-up tools** (TAPAS's
ADR-021 default, `transform.mjs:79-81`). If you are single-tool today, ship without the transform and
add it the day a second, repo-rooted tool appears. MDP's junction trick is the right *fallback* when
agents must `cd` into siblings and you want skills present there without copying — but it is
OS-specific (Windows junctions) and brittle on fresh clones; prefer launch-from-root if you can.

**Trade-off accepted.** Choosing the transform buys multi-tool reach at the cost of a build step,
`.staging/` output, and a manual (TAPAS) or scripted copy into siblings — a pipeline that *itself*
broke when ADR-020 renamed a repo (`ADR-021:25-30`). Choosing pure single-source buys radical
simplicity at the cost of *only ever supporting walk-up tools*. You cannot have both Copilot-in-IDE
**and** zero per-repo files — that is a tool-architecture fact, not indecision.

### Fork 2 — Dependency / coupling strategy

**The three answers.** TAPAS: shared **Maven** libraries resolved through an artifact repository, with
a **version matrix** (`dependency-map.json:1-32`) and an auto-bump-PR bot keeping consumers current —
plus relative paths for *documentation* cross-refs only. MDP: **no shared internal packages at all** —
each repo owns its stack; services couple by **REST contract** governed by ADRs, with a workflow that
bumps the frontend version the backend references. de-braighter: **published `@de-braighter/*`
packages** to GitHub Packages, consumed via caret ranges (`exercir package.json:45-46`).

**Who wins — depends on whether the repos share *code*.** 

- Repos that share **library code** (≥2 consumers of the same types) → **published packages**
  (de-braighter) give clean versioning, immutability, and a real public-API boundary. **But**
  de-braighter's own memory is full of the cost: contracts `0.14.0`/runtime `0.19.0` shipped while
  exercir still pins `^0.12.0`/`^0.17.0` — **publish→adopt latency manifests as version skew.**
- Repos that share **no code, only contracts** (independent services) → **MDP wins**: don't manufacture
  shared libraries you don't need; govern the REST contract with an ADR and bump by workflow.

**Unified choice.** **Published packages for shared contracts/libraries** (de-braighter's model — it is
the only one of the three with a real package boundary), **+ TAPAS's version-matrix + auto-bump bot to
fight the skew** that published packages inevitably create. For service-to-service coupling with no
shared code, **MDP's contract-only approach** — no package at all. Relative paths: reserve for
*doc* cross-references (TAPAS's discipline), never for build-time code coupling.

**Trade-off accepted.** Published packages cost you instant cross-boundary edits — every change to a
contract is a publish cycle before the consumer sees it (the skew). Shared Maven libs / relative
source give instant edits but couple builds and re-introduce the "edit here, break there" blast radius
that package versioning exists to contain. The auto-bump bot is the cheapest way to keep the
published-package win without drowning in skew — **de-braighter is the one workbench that has the
boundary but lacks the bot, and it shows.**

### Fork 3 — Multi-agent concurrency

**The three answers.** MDP runs **Quartiermeister**, a Dockerized MCP server that makes parallel agent
sessions first-class: atomic scope-overlap rejection so two sessions "cannot race on the same
files/story/bug" (`AGENTS.md:95`), claim/heartbeat/handoff, work-queue pick, and SDLC phase
transitions, with a 7-panel diagnostic UI (`quartiermeister/README.md:29-63`). de-braighter uses git
**worktrees** — verifiers run `isolation:"worktree"` (`verifier-wave.md:30-40`) — giving filesystem
isolation but **no claim arbitration** (its memory records "shared-working-tree concurrency" biting
when sessions switch branches under each other). TAPAS has no special concurrency infra.

**Who wins — depends on *where* the sessions run, not just how many.** It is tempting to dismiss the
alternative as "a status file that races and goes stale" — but that conflates a *passive note* with a
*lock*. A real lock uses an **atomic filesystem op** (`mkdir` fails-if-exists, `open(O_CREAT|O_EXCL)`) —
the very mechanism `git` uses for `.git/index.lock` — so for **same-machine** sessions it gives genuine
mutual exclusion with no server. Under the hood the MCP does the *same* thing (serialize a claim); it is
a process holding state that could equally be files. The server only pulls ahead when arbitration must
be **networked** (sessions on different machines) or **logic-rich** (automatic sub-issue path-overlap).
MDP's win is real, but its setting (a team, many sessions, possibly different machines) is what
*justifies* the server — it isn't free correctness over a lock file for the **local** case.

**Unified choice — a three-rung ladder, climb only as forced.** (1) **git worktrees always** —
filesystem isolation per session (de-braighter). (2) **For local parallel sessions:** claim via the
**tracker** (assign the GitHub issue / Jira ticket to yourself before starting — a persistent,
observable claim with *zero* new infra) **+ a local lock *directory*** (`.locks/<story-id>/` via atomic
`mkdir`, holding `{pid,host,startedAt}` for stale-reclaim) to guard the races worktrees don't. (3) **A
Quartiermeister-shaped MCP claim-server** only on a named threshold: **cross-machine** sessions,
**sub-issue path-overlap** arbitration, high claim churn, or wanting the live handoff/queue **hub + UI**.
Lock at **story/issue grain** so scopes are disjoint by construction — then rung 2 needs no overlap
*logic* at all.

**Trade-off accepted.** Rung 2 gives up two things the server has: (a) **cross-machine** coordination —
a local lock coordinates nothing across filesystems, so the day sessions go remote you *must* climb to
rung 3; and (b) **fine-grained auto-overlap** — traded for the discipline of decomposing work into
disjoint issues. You also own the lock's correctness: the **check→claim must be atomic** (one lock dir
per story makes scopes disjoint, sidestepping the TOCTOU race) and **stale locks need a pid/TTL reclaim**
— and on Windows (this shop) use the **`mkdir`-directory** pattern, *not* POSIX `flock` (which won't
auto-release the same way). None of that is a server; all of it is a few lines. Climb to the MCP when a
*second* force genuinely demands it — the same ADR-176 "≥2 forces" test the kernel uses on itself.

### Fork 4 — Governance weight

**The three answers.** de-braighter: a **written constitution enforced by an LLM agent** —
charter-checker asks "does this still behave like Substrate?" against the ADR-176 inclusion test and
ring boundaries, on every PR, in parallel with three other verifiers, all worktree-isolated
(`charter-checker.md:3,37-57`; `verifier-wave.md`). MDP: **machine-enforced, self-testing** ADR
compliance — `check-adr-compliance.sh` greps for violation shapes and has a `--self-test` mode that
proves the rules still fire (`check-adr-compliance.sh:9-30`) — plus a Copilot-review merge gate. TAPAS:
a single adversarial `pr-review` stage + `check-conventions`, no charter.

**Who wins — de-braighter on depth, MDP on cost-per-rule.** de-braighter's governance has genuine
teeth and is the only one that defends an *architecture* (not just code style). But charter-checker is
an LLM judgment call — expensive and non-deterministic. MDP's insight is the cheaper complement: **any
rule that can be mechanized should be a self-testing grep, not an LLM**. The two are not rivals.

**Unified choice.** **Three tiers, scaled to risk:** (1) **mechanizable rules → self-testing scripts**
(MDP) — deterministic, cheap, run in pre-commit/CI; (2) **architectural/semantic invariants → an
LLM charter-checker** (de-braighter) — only for what *can't* be grepped; (3) **a parallel verifier
wave** (de-braighter) for non-trivial PRs. **Governance weight should scale with `#ADRs × #contributors`.**
de-braighter's weight is *justified* by 201 ADRs + a substrate constitution; the same weight on MDP's
24 ADRs or a solo prototype would be ceremony.

**Trade-off accepted.** Heavy governance slows the first 80% of a young project for safety that only
pays off at scale; light governance scales worse as ADR count and contributor count climb (TAPAS's
ADRs are already drifting across repo + Confluence — see Fork 6). The mistake is applying *either*
unconditionally. Pick weight by the multiplier, and revisit it as the project grows.

### Convergence 5 — Sibling mechanism & manifest (near-unanimous)

All three independently chose **gitignored nested clones with their own `.git`, not submodules**
(`.gitignore:15-20` TAPAS; `.gitignore:1-4` MDP; `.gitignore:2-10` de-braighter; none has
`.gitmodules`). When three independent designs agree, treat it as settled: **submodules' atomic
cross-repo pinning is not worth their ergonomic tax** for an agent-driven, frequently-edited cluster.

The split is *manifest format*: TAPAS and de-braighter use a **YAML manifest** (`tapas-repos.yaml`,
`repos.yaml`) that a tool can read (de-braighter's `init-workbench` skill consumes it); MDP uses a
**markdown table** (`README.md:35-40`) — human-readable but not machine-actionable. **YAML wins** — it
drives init tooling and a drift-check. But note both YAML manifests were **stale** (TAPAS lists
`r2d`/`pergamum` that don't exist; de-braighter omits `herdbook`). **A manifest is only as good as its
discipline — add a CI check that the manifest set equals the on-disk clone set.** That single check
would have caught all three drifts.

**Unified choice.** YAML manifest + a `manifest == on-disk clones` CI assertion. Encode TAPAS's repo
**`role`** field (`expected-state`/`current-state`/`delta`, `tapas-repos.yaml:14-35`) — it is free
documentation of *why each repo exists* and feeds the conceptual model (Convergence 8). **Fold the tool
universe in here too** — a `tools:` block (param 1) — so **one tracked manifest declares both repos and
tools** and `init`/the transform read a single file. **Trade-off:**
a YAML manifest needs maintenance the markdown table pretends not to — but the table's "no maintenance"
is an illusion (it drifts silently); the CI check makes the cost explicit and small.

### Convergence 6 — ADR homing

**Clear ranking.** de-braighter wins decisively: **201 ADRs, single-homed, frontmatter-governed**
(ADR-181) with a `spec-auditor` enforcing numbering and cross-refs (`adr-027:1-9`). MDP is a solid
runner-up: one directory, 24 ADRs, explicit lifecycle + immutability (`adr/README.md:29-46`), and the
standout **machine-checkable compliance** script. TAPAS is the cautionary tale: ADRs are **split across
a repo `decisions/` dir *and* a separate Confluence space (ADR-029..039) that is explicitly "not yet
reconciled"** with the repo numbering (`ADR-020:41-42`) — i.e. two sources of truth and a numbering
collision risk.

**Unified choice.** **Single-homed ADRs in the repo, one numbering line, YAML frontmatter + an auditor
(de-braighter), plus MDP's self-testing compliance scripts for the mechanizable ones.** Never split
ADRs between a repo and a wiki. **Trade-off:** none worth the name — TAPAS's Confluence split buys
wiki-discoverability for non-engineers at the cost of drift and double-numbering; export a rendered
view to the wiki instead of authoring there.

### Convergence 7 — SDLC tracking

**The fork that's really an org fact.** TAPAS and MDP both track work in **Jira** (`ATTP-NNN`,
`MDP-NNN`) — because Swiss Post already runs Jira; the plan "lives in Jira, read live — there is no
local board mirror" (TAPAS `primer:41-42`), and MDP generates a read-only `WORK-QUEUE.md` snapshot from
JQL where "when this file disagrees with Jira, Jira wins" (`WORK-QUEUE.md:6-9,20-22`). de-braighter uses
**GitHub issues** *and* the genuinely novel **dogfooded SDLC twin**: PRs carry `Producer:`/`Effect:`
lines that the `devloop` domain ingests via a `drain/backfill/reconcile` ritual to **calibrate
per-producer delivery predictions** (`policies/git.md:50-88`).

**Who wins — org-dependent, but de-braighter's twin is a unique asset.** If your org runs Jira, fight
it at your peril — adopt **Jira + a generated, never-authored snapshot** (MDP's "Jira wins" rule is the
correct discipline; never let a local file become a second source of truth). If you are independent,
**GitHub issues** keep tracking in the same tool as the code. Either way, de-braighter's **delivery
twin is a layer worth stealing** regardless of tracker — it is the only one of the three whose
*process observes itself*.

**Unified choice.** Tracker = wherever the org already lives (Jira if mandated, else GitHub issues),
with **exactly one source of truth** and any local view **generated, not authored** (MDP). Bolt on
de-braighter's `Producer:`/`Effect:` self-observation on top of *whichever* tracker. **Trade-off:** the
twin adds a per-PR ritual (drain/backfill/reconcile) — real discipline cost — for a calibration payoff
that only compounds over many PRs; worth it for a long-lived team, skippable for a throwaway.

### Convergence 8 — Conceptual model

**Two rich models at different altitudes, plus one pragmatic spine.** TAPAS's **r2d two-pole** is a
*project-state* model: authored **expected** (`specs`) vs authored **current** (`devops` + running
services), with the **delta computed** by QA and the **plan external** in Jira (`primer:35-42`) — cheap,
clarifying, and answers "where does truth live?". de-braighter's **substrate kernel** is a
*product-architecture constitution*: four concerns, the ADR-176 inclusion test, ring boundaries, "store
generators, derive graphs", and a twin expressed as prior→posterior→counterfactual (`adr-176`;
north-star `:343-345`) — deep, but only because **the model *is* the product being built.** MDP's
**pipeline-as-directory-spine** (`domain → stories → design+ADR → code → QA`) is the pragmatic default:
the SDLC stages *are* the top-level folders (`adr/README.md:7-17`).

**Who wins — they don't compete; layer them.** 

- **Directory spine →** MDP's pipeline-as-folders is the best *default* layout for a workbench that
  isn't building a platform.
- **State discipline →** TAPAS's two-pole (authored-truth vs derived vs external) is a near-free
  organizing principle every workbench benefits from — it tells you which repos are *sources* and which
  are *derived*, and stops you from authoring what should be computed.
- **Kernel constitution →** de-braighter's kernel-minimality doctrine is *only* worth its weight **if
  you are building a substrate/platform product**. Importing it into an app workbench is cargo-culting
  governance for a kernel you don't have.

**Unified choice.** Pipeline-as-directory-spine (MDP) + the two-pole authored/derived discipline
(TAPAS) as the baseline conceptual model for *any* workbench; **add** the kernel constitution
(de-braighter) **iff** the cluster's purpose is to build a platform. **Trade-off:** the kernel doctrine
is the single heaviest idea in all three workbenches — it pays for itself when you have a kernel that
≥2 packs depend on, and is pure overhead otherwise.

## Deliverable 3 — The ideal workbench

A synthesized design. It is **parameterized by four switches** (set them once, up front); everything
else is fixed best-practice drawn from whichever workbench won that axis.

### The five parameters (decide these first)

Four are architectural choices set once; the fifth is a **lifecycle stage** that flips over time.

1. **Toolchain** *(configured, not hard-coded)* — the supported-tool universe is **declared** in tracked
   `repos.yaml`'s `tools:` block; each machine picks its active subset via `.env` `WORKBENCH_TOOLS=…`. The
   presence of any `discovery: repo-rooted` tool (Copilot/Cursor) is what pulls in the transform (Fork 1).
2. **Concurrency** — `low` / `local-parallel` / `cross-machine`. → sets the rung: worktrees-only →
   +tracker-claim & lock-dir → +MCP claim-server (Fork 3).
3. **Coupling** — `shared-code` (publish packages) **or** `contract-only` (no shared packages) — possibly
   both, per repo pair. → Fork 2.
4. **Purpose** — `app` **or** `platform` (are you building a kernel ≥2 things depend on?). → decides
   whether the kernel constitution applies (Fork 4 / Convergence 8).
5. **Control-plane maturity** *(time-varying)* — `churning` (direct-to-main on the workbench *permitted* —
   a convenience) **or** `stable` (PR-gate the workbench `main` like any sibling — the proper steady state).
   Start `churning`; flip to `stable` once the control plane settles and others depend on it. → Governance.

### Directory layout (fixed)

```
workbench/                         ← control-plane repo; main: open while churning → PR-gated once stable (param 5); siblings always PR-gated
├── AGENTS.md                      ← canonical, provider-agnostic agent entry (the one source of truth)
├── CLAUDE.md                      ← thin "@AGENTS.md" pointer + launch-from-root rule
├── repos.yaml                     ← one manifest: per-repo `role` + a `tools:` universe block (param 1); CI asserts repos == on-disk
├── ai-instructions/               ← the tool-AGNOSTIC agent corpus ("knowledge root"); humans read it too
│   ├── context/                   ← behaviour/identity — COMPILE-SOURCE (→ per-tool bundles; multi-tool only)
│   ├── policies/                  ← coding/git/testing/docs/voice — REFERENCED as-is (non-emitting)
│   ├── templates/                 ← adr/pr/story/sprint scaffolds — REFERENCED as-is (non-emitting)
│   ├── workflows/                 ← verifier-wave/designer-first/story-tracker — REFERENCED as-is (non-emitting)
│   ├── schema.yaml                ← frontmatter contract for the compile-source       (multi-tool only)
│   └── tools/transform.mjs        ← compiles ONLY context/ → .claude, .github/copilot-* (multi-tool only)
├── .claude/{agents,skills,commands,settings.json}   ← tool-SPECIFIC config (canonical, or generated when multi-tool)
├── tools/mcp/                     ← MCP servers (context/db/…); + claim-server ONLY IF concurrency=high
├── scripts/                       ← wrapper scripts (build/test/lint) the agents must use
├── <stage-or-role>/               ← pipeline spine (MDP) OR role clusters (layers/ domains/) — both fine
│   └── <sibling clones>           ← gitignored, own .git, NOT submodules
└── .gitignore                     ← tracks the corpus + .claude; hosts clones + secrets + build output
```

**The grouping rule (why `ai-instructions/` parents policies/templates/workflows).** Everything an agent
reads to know *how to work here* lives in one corpus — but split by **lifecycle**: `context/` is
**compile-source** (the transform assembles it into per-tool bundles); `policies/ templates/ workflows/`
are **referenced as-is** at runtime (a skill opens a template, the orchestrator consults a workflow).
Both belong in the corpus; only the compile-source is emitted. **Guardrail:** the transform must compile
*only* the marked subtree (`context/`, or files carrying `emit:` frontmatter) — never blind-walk all of
`ai-instructions/`, or it will emit an ADR template as a tool-instruction file. This is the one rule that
lets the corpus stay unified without the compiler over-reaching. (The corpus is **always present**; only
`schema.yaml` + `tools/transform.mjs` are multi-tool-conditional. If "ai-instructions" grates as a name
for human-facing operating procedure, `ai/` or `agent/` carries the same grouping.)

### Control-plane contents (fixed)

- **Agents + skills + commands** canonical at the **root only** (de-braighter). No per-sibling copies of
  walk-up-tool config — ever.
- **`policies/` + `templates/` + `workflows/` as one corpus under `ai-instructions/`** — the content
  de-braighter got right (first-class, not scattered as `_TEMPLATE.md` files (MDP) or buried in a sibling
  (TAPAS)), but **grouped under the agent knowledge-root** rather than as separate top-level dirs, so the
  agent corpus is one tree. They are **referenced as-is** (non-emitting), distinct from the compiled
  `context/` source beside them.
- **A `verifier-wave` workflow** scaled to risk + **self-testing compliance scripts** for mechanizable
  rules (MDP) + **a charter-checker** *iff* `purpose=platform`.

### Agent-entry + tool-integration model (the parameterized core)

- **Canonical source = one provider-agnostic `AGENTS.md`.** `CLAUDE.md` is a thin `@AGENTS.md` pointer
  (TAPAS/MDP pattern — works for both Claude and others).
- **Walk-up tools consume it in place. Zero replication.** Launch from root by default (de-braighter);
  if agents must `cd` into siblings, share skills by junction/symlink (MDP) rather than copying.
- **`if toolchain == includes-repo-rooted`:** add `ai-instructions/{schema.yaml,tools/transform.mjs}` and
  compile **only** the `context/` subtree into per-repo Copilot config, **defaulting to emit-nothing for
  walk-up tools** (TAPAS ADR-021). `policies/ templates/ workflows/` stay non-emitting. Output to a
  gitignored `.staging/`, synced by script (not by hand).
- **`else`:** the `ai-instructions/` corpus still exists (policies/templates/workflows/context), just with
  **no `schema.yaml`/`transform.mjs`** — nothing to compile. The day a repo-rooted tool joins, add only the
  compiler bits — the corpus doesn't move.
- **Tool selection is *configured*, not hard-coded — two layers (tracked-vs-local, same split as the
  rest of the workbench).** **(a) Tracked universe** — a `tools:` block in `repos.yaml` (one
  manifest for repos *and* tools) declares every supported tool with `discovery` (walk-up | repo-rooted),
  `format`, and `emit` (root-only | per-repo);
  the invariant `emit=per-repo ⟺ discovery=repo-rooted` is **ADR-021 expressed as data**, not a hard-coded
  branch. **(b) Local selector** — a gitignored `.env` (`WORKBENCH_TOOLS=claude,copilot`) picks the
  per-machine active subset. The transform emits **(universe ∩ selector)**, generalising TAPAS's
  remembered `--provider` flag into declared config. **Reproducibility rule (load-bearing):** the
  *committed* per-repo bundles regenerate from the **tracked** universe and are best produced in **CI**, so
  they never depend on anyone's `.env`; the `.env` selector governs only **local, gitignored** tool config
  (`.claude/settings.local.json`, your `.opencode/`) and **must never delete a tracked artifact** a
  teammate relies on. Net: Parameter 1 becomes an **editable one-liner** — adding Cursor is a row in
  the manifest's `tools:` block, not a redesign.

### Dependency strategy (per repo pair)

- **Shared code (≥2 consumers)** → published `@scope/*` packages (de-braighter) **+ a version matrix +
  auto-bump bot** (TAPAS) to kill skew. This bot is the piece de-braighter is missing and should add.
- **No shared code** → contract-only coupling governed by an ADR (MDP); no package.
- **Docs** → relative paths only (TAPAS).

### Governance level (scaled, not fixed)

Weight `∝ #ADRs × #contributors`. Always: PR-gated siblings, single-homed frontmatter ADRs + auditor,
self-testing compliance scripts. Add the parallel verifier wave for non-trivial PRs; add the LLM
charter-checker only for `purpose=platform`.

**Control-plane protection is staged, not fixed (parameter 5).** An *unprotected* workbench `main` is a
**convenience for the `churning` phase** — while the control plane changes daily and the operator is
solo, PR-gating your own scaffolding is friction with no reader to serve. It is **not** the proper steady
state. Once the control plane **stabilises** (agents/skills/policies settle, ≥2 contributors depend on
it), PR-gate the workbench `main` too — arguably **more** strictly than siblings, because an errant edit
to a policy, agent, or skill has **cluster-wide blast radius**. The spec supports **both**: `churning` →
direct-to-main permitted; `stable` → direct-to-main forbidden. The evidence already tracks this — the two
faster-churning workbenches (TAPAS, MDP) leave workbench-`main` open, while the most-mature, most-governed
one (de-braighter) already states *PR-gated everywhere, incl. the control plane* (`policies/git.md:9-10`).
"Open" correlates with **stage**, not correctness — so make it an explicit graduation, not a default.

### Conceptual model (layered)

Pipeline-as-directory-spine (MDP) **+** two-pole authored/derived/external state discipline (TAPAS) as
the baseline; **+** kernel-minimality constitution (de-braighter) iff `purpose=platform`. Bolt on the
`Producer:`/`Effect:` **delivery self-observation** (de-braighter) on top of whatever tracker the org
mandates — it is tracker-agnostic and compounds.

### Concurrency

A three-rung ladder; climb only as forced. **(1) git worktrees always** — filesystem isolation per
session. **(2) local parallel sessions** → claim via the **tracker** (issue/ticket assignment = a free,
persistent, observable claim) **+ a local lock *directory*** (`.locks/<story-id>/` via atomic `mkdir`,
`{pid,host,ts}` for stale-reclaim; on Windows use `mkdir`-dir, **not** `flock`). Lock at story/issue
grain so scopes are disjoint and no overlap-logic is needed. **(3) MCP claim-server (Quartiermeister)**
only on a named threshold — **cross-machine** sessions, sub-issue **path-overlap** arbitration, high
churn, or wanting the live hub/UI. The MCP is *not* free correctness over a lock file for the local
case — it earns its weight only when arbitration must be **networked or logic-rich**.

### Migration sketch — moving any one toward the ideal

Each is already close on different axes; the sketch is short because the ideal *is* the best-of-three.

**TAPAS → ideal** (already wins Forks 1 & 2; gaps are governance & ADR homing):

1. **Reconcile ADRs to one home.** Collapse the Confluence ADR space (029–039) and the repo
   `decisions/` into a single numbering line in `attp-tapas-specs`; export a rendered view to Confluence
   instead of authoring there. Finish moving ADR-020/021 out of `docs/proposals/` into `decisions/`.
2. **Fix the manifest drift.** Remove `r2d`/`pergamum` from `tapas-repos.yaml`; add the
   `manifest == on-disk` CI check. (The same ADR-020 rename that broke `transform.mjs` is the lesson.)
3. **Add a charter/verifier tier only if it grows a platform.** TAPAS is an app — keep governance light;
   add self-testing compliance scripts (borrow MDP's pattern) for its conventions before reaching for a
   charter-checker.
4. **Finish ADR-021 propagation.** Service repos still carry to-be-dropped `.claude/`/`.opencode/`
   bundles — complete the drop so siblings hold only the `AGENTS.md` pointer + Copilot config.

**MDP → ideal** (already wins Fork 3; gaps are manifest, ADR homing format, package boundary):

1. **Promote the markdown repo table to a YAML manifest** (`repos.yaml`) with `role` per repo + the
   on-disk CI check — keep the table as a generated view.
2. **Adopt frontmatter ADR governance + an auditor** (de-braighter ADR-181) on top of its already-good
   self-testing compliance scripts.
3. **Keep contract-only coupling** (it is correct for independent services) — but the moment two repos
   share code, reach for a published package, not a vendored `node_modules` copy.
4. **Keep Quartiermeister, but recognise it as rung 3** — it is the right answer at MDP's scale (a team,
   many sessions). The *exportable lesson* for the others is "treat concurrency as an active mechanism,
   not etiquette"; they should adopt the **tracker-claim + lock-dir** (rung 2) first and reach for an
   MDP-style server only at the cross-machine / path-overlap threshold (Fork 3).

**de-braighter → ideal** (already wins Forks 1, 3 framing & 4; gaps are skew & multi-tool readiness):

1. **Add the version-matrix + auto-bump bot** (TAPAS) — close the contracts/runtime ↔ consumer skew
   (`0.14.0`/`0.19.0` vs `^0.12.0`/`^0.17.0`) that its memory keeps tripping on. This is the single
   highest-value graft.
2. **Fix `repos.yaml` drift** (add `herdbook`) + add the `manifest == on-disk` CI check.
3. **Pre-stage multi-tool readiness** *without* building it: keep `AGENTS.md` as the canonical name (it
   already half-does via the specs-layer generated `AGENTS.md`); if Copilot ever joins, add TAPAS's
   transform with the ADR-021 walk-up default — don't replicate before then.
4. **Borrow MDP's self-testing compliance scripts** for the mechanizable charter rules, reserving the
   LLM charter-checker for the genuinely semantic invariants — cheaper and deterministic where it can be.

## Appendix — verification honesty

Per the prompt's "treat prior context as hypothesis" rule, what the profiles **confirmed**, **refuted**,
or **could not prove**:

- **Confirmed:** all sibling mechanisms (gitignored clones, not submodules); TAPAS ADR-021 walk-up
  default baked into `transform.mjs:79-84`; TAPAS r2d two-pole; de-braighter single-source no-replication
  (no sibling carries `agents/`/`skills/`); de-braighter published `@de-braighter/*` packages + ADR-027.
- **Refuted / corrected:** TAPAS ADR-021 is **decided but only partially propagated** — service repos
  still carry `.claude/`/`.opencode/` to be dropped (not "fully applied"). de-braighter's
  "expected/current/delta" is **not** a literal triple — it is expressed as prior→posterior→counterfactual
  in the north-star. MDP was unknown and is now characterized: a meta-repo whose differentiator is
  enforced concurrency, not anything in the prior context.
- **Could not prove from files:** TAPAS **sibling `main` branch protection** is asserted in docs
  (`ADR-020:88-90`) but no ruleset file was on disk to cite — documentary, marked `†`. Both YAML manifests
  are **stale** (TAPAS lists non-existent repos; de-braighter omits `herdbook`) — flagged `~stale`.

> **Note on this repo's own rules.** Per `policies/git.md`, the de-braighter workbench is PR-gated even
> for docs. This analysis is an untracked working artifact; committing it should go through a PR (with a
> `Producer:` line), not direct-to-main.





