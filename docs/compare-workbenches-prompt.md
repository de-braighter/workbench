# Prompt — compare three agentic-workbench approaches and design the ideal one

> Copy everything below the line into a fresh Claude Code session (launched from
> `D:\development\projects\de-braighter` so it can read all three paths).

---

You are comparing **three independently-evolved "agentic workbench" setups** on this machine and
synthesizing a single **best-of-all-worlds** design. A "workbench" here = a *control-plane* repo that
orchestrates many sibling repos for AI-agent-driven development (multi-repo, multi-tool).

## The three workbenches

1. **TAPAS** — `D:\work\projects\attp-tapas-local-workbench` (Swiss Post time-keeping).
2. **MDP** — `D:\work\projects\mdp` (you have **no prior context** — discover it from the files).
3. **de-braighter** — `D:\development\projects\de-braighter` (a "substrate" cluster; this is the dir
   you're launched from).

> Note: `D:\work\*` is outside the de-braighter opt-in root — **analyze it, but do not apply
> de-braighter's standards/skills to it.** This is a comparison, not a conformance check.

## What to read for each (don't assume — cite file evidence)

- **Root files:** `CLAUDE.md`, `AGENTS.md`, `README.md`, and the **repo manifest**
  (`tapas-repos.yaml`, `repos.yaml`, or equivalent).
- **Layout:** directory tree — how sibling repos are grouped/nested; `.gitignore` (what the control
  plane *tracks* vs merely *hosts*); are siblings gitignored nested clones, submodules, or separate?
- **Control plane:** `.claude/` (agents / skills / commands), `ai-instructions/` (or equivalent
  instruction source), `policies/`, `templates/`, `workflows/`, `scripts/`, `tools/` (MCP servers?).
- **Agent entry + AI-tool integration:** how each tool (Claude Code, GitHub Copilot, OpenCode,
  Cursor…) discovers context. Single-root-launch vs replicate-into-every-repo. Any generate/sync
  pipeline (e.g. a transform that emits per-repo configs).
- **Dependency strategy:** published packages vs relative paths vs shared libs + version matrix.
- **Governance / SDLC:** ADRs, charter/constitution checks, verifier patterns, PR + branch-protection
  workflow.
- **Conceptual model:** any explicit state model (e.g. expected/current/delta), kernel/substrate
  framing, knowledge organization.

> Efficient approach: fan out one read-only sub-agent per workbench to produce a structured profile,
> then synthesize. (Only do this if multi-agent is acceptable for this session.)

## Prior context — TAPAS & de-braighter (from a deep session; **verify, may be stale**)

**TAPAS** — control plane + **gitignored** sibling clones under `specs/ services/ platform/ qa/`,
each its own git repo. `AGENTS.md` = provider-agnostic single entry, currently **replicated into
every repo**; the real source is `ai-instructions/`, compiled by a transform
(`ai-instructions/tools/transform.mjs`) into per-tool bundles — Copilot (`.github/copilot-instructions.md`,
`.github/prompts/`), Claude (`.claude/skills/`), OpenCode (`.opencode/commands/`) — then **manually
copied** to siblings. A recent decision (ADR-021) cuts this back: **walk-up tools (Claude Code,
OpenCode) find the root config by walking up the tree, so per-sibling copies are redundant; only
GitHub Copilot is repo-rooted and genuinely needs a per-repo `.github/copilot-instructions.md`.** So
siblings keep only Copilot config + `AGENTS.md`; `CLAUDE.md` becomes a **gitignored local
`@AGENTS.md` pointer**. Discovery via `tapas-repos.yaml` manifest. Conceptual model = **r2d /
two-pole**: `requirements`(expected) + `devops`(current) + a *derived* delta; requirements+ADR+
acceptance consolidated into one `spec` repo (ADR-020); the delta is qa-measured, the plan lives in
**Jira** (not a repo). Coupling = relative paths + shared **Maven** libs (`common-java`/`common-model`)
+ a version matrix in `devops` (NOT published packages). MCP servers live in `tools/mcp/`. Sibling
`main` branches are **protected (PR-only)**; the workbench repo's `main` is open.

**de-braighter** — cluster root *is* the `workbench` repo; `.claude/agents/` (~23) + `.claude/skills/`
(~38) are **canonical at the root only**, and you **must launch from the root** (launching inside a
sibling loses the agents/skills) — i.e. **single control plane, no per-sibling AI-config
replication.** Gitignored sibling **layer + domain** repos under `layers/ domains/`. Coupling =
**published `@de-braighter/*` packages** (domains consume layers via packages, not relative paths —
ADR-027). Strong governance: a substrate **kernel** (4 concerns, ADR-176 inclusion test, ring
boundaries 0–3 kernel / 4–5 packs, "store generators, derive graphs"), **ADR-gated** everything
(incl. specs), **verifier waves** (local-ci + reviewer + charter-checker + qa-engineer in parallel,
worktree-isolated), designer-first, `policies/ templates/ workflows/`. Discovery via `repos.yaml`.

**MDP** — unknown; profile it fresh.

## Deliverables

1. **Comparison matrix** — the three workbenches × the dimensions above (one cell = a short, evidenced
   characterization).
2. **Per-dimension synthesis** — for each axis: which approach wins, *why*, and the recommended
   unified choice. **Name the genuine trade-offs** — don't take the union; where two approaches
   conflict (e.g. *replicate-per-repo* vs *walk-up*, *published-packages* vs *relative-paths*,
   *heavy-ADR-governance* vs *lightweight*), make a reasoned call and say what you're giving up.
3. **The ideal workbench** — a concise spec of the synthesized design: directory layout, control-plane
   contents, agent-entry + tool-integration model, dependency strategy, governance level, conceptual
   model — plus a **short migration sketch** for moving any one of the three toward it.

## Ground rules

- **Cite file evidence** for every claim (`path:line` where possible). Treat the prior context above
  as a hypothesis to confirm, not fact.
- **Don't homogenize** — the best design may keep different answers for different *contexts* (e.g.
  Copilot-in-isolation vs Claude-Code-from-root is a real, tool-driven split, not indecision).
- **Optimize for the actual use** — note who works where (solo vs team, IDE-Copilot vs CLI-agent,
  single-repo-clone vs whole-workbench) because the right answer depends on it.
- Be concrete about the **least-obvious wins** of each (they're easy to miss): e.g. de-braighter's
  single-source control plane vs TAPAS's tool-aware sync vs whatever MDP does well.
