# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

`D:/development/projects/de-braighter/` is **both**:

1. The git repo `de-braighter/workbench` — canonical `.claude/agents/`, `.claude/skills/`, settings, policies, templates, workflows, project descriptors, and design docs.
2. The cluster root — sibling layer + domain + attic repos clone into `layers/`, `domains/`, and `attic/`.

**Claude Code is always launched from this directory.** `.claude/` here applies to all work across the cluster. Do not launch Claude Code from inside a sibling repo (you would lose access to the agents and skills).

## Substrate kernel — core model + governance (read first)

The substrate is **internal infrastructure**, and its defining strength is **simplicity**: model the kernel **as simple as possible but as complex as required**. This is the *major principle every session must apply* — ratified in **[ADR-176](layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)**. When in doubt, the kernel does *less*; complexity belongs in packs.

**The kernel is exactly four concerns** (north-star §20 P3; [ADR-127](layers/specs/adr/adr-127-kernel-substrate-v1.md)):
1. **Recurse the plan** — a strictly single-parent tree of intervention nodes carrying typed effect declarations.
2. **Flat the observation** — an append-only event log of what happened.
3. **Inference** — plan + observations → posteriors (the digital twin).
4. **Reproducibility** — versioned catalogs, run manifests, event-sourcing.

**Inclusion test — before adding anything to the kernel, both must hold:** (a) it is one of the four concerns, **and** (b) it is needed by **≥2 packs** as shared infrastructure the kernel must validate/query/version. Both yes → kernel. Otherwise → pack territory (typed pack lib + `metadata` JSONB). Supporting rules:
- **`metadata` JSONB is the deliberate simplicity boundary**, not a leak — the untyped per-pack extension space that keeps the typed core small.
- **Promotion rule** — promote a `metadata` shape into the typed core *only* on demonstrated multi-pack need; demand-driven, never speculative.
- **Store generators, derive graphs** — relationships derivable from tree + declarations (the causal DAG, comorbidity conflicts) are *views/materialized queries*, never stored state. Cross-links, if ever needed, are a separate `PlanNodeId` relation, **never** multi-parent.

**Packs architecture:** packs **compose**, they do not author kernel concepts or UI components (bricks live in `design-system`, [ADR-168]; packs consume them). Domains consume layers via **published `@de-braighter/*` packages**, not relative paths ([ADR-027] pack-on-platform). Pack-specific representation/relationships live in the pack + `metadata`, never the kernel.

**Depth (citable, in `layers/specs/`):** ADR-176 (kernel minimality + the inclusion test; ratified) · ADR-127 (kernel substrate v1) · ADR-154 (effect-declaration algebra) · ADR-027 (pack architecture) · north-star §9 (the "collapse into one substrate" thesis) + §20 (principles).

## Layout

```
de-braighter/                     ← this repo (de-braighter/workbench)
├── .claude/
│   ├── agents/                   ← 23 canonical agent definitions
│   ├── skills/                   ← 38 canonical skill folders
│   ├── commands/                 ← slash commands (when added)
│   └── settings.json
├── policies/                     ← coding.md, testing.md, git.md, docs.md, voice.md
├── templates/                    ← adr/, concept/, story/, pr/, sprint/
├── workflows/                    ← verifier-wave.md, designer-first.md, story-tracker.md
├── projects/<key>/project.yaml   ← per-domain descriptors (metadata only)
├── docs/superpowers/             ← design specs + implementation plans
├── layers/                       ← cluster: sibling layer repos (gitignored here)
│   ├── substrate/
│   ├── design-system/
│   ├── specs/
│   ├── platform/
│   └── foundation/
├── domains/                      ← cluster: sibling domain repos (gitignored here)
│   ├── exercir/
│   └── conservation/
└── attic/                        ← preservation repo (gitignored here)
```

## Cluster state (migration complete 2026-05-25)

All layers and domains are migrated into the cluster, re-scoped `@de-braighter/*`, building green on `main`:
- **Layers:** `substrate` (kernel — `@de-braighter/substrate-{contracts,runtime}`), `design-system`, `specs`, `platform`, `foundation` (shared packages — `@de-braighter/{std,lint-kit,test-kit}`).
- **Domains:** `exercir` (team sports — the live pack-football work), `conservation`.

The old prototype directories under `D:/development/projects/braighter/` and `/exercir/` are deleted (content lives in the cluster + git history). **Gate:** remote GitHub Actions is billing-blocked until ~June, so the working gate is **local** — `npm/pnpm run ci:local` per repo + shared SonarQube (`localhost:9000`). Never bypass pre-push hooks.

## Workflow rules

- **PR-gated everywhere**, including specs/ADRs. No direct-to-main. See `policies/git.md`.
- **Review floor (2026-06-13): no PR merges unreviewed.** Every PR gets at least a single `/code-review` pass (one agent, low effort); **non-trivial** PRs get the full **verifier wave** (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`, in parallel, all with `isolation: "worktree"`; `exercir-charter-checker` joins on `domains/exercir/` PRs) on top. The SDLC twin showed ~93% of PRs were merging with zero agent review; the floor closes that. See `workflows/verifier-wave.md`.
- **Designer-first** for risky changes — new ports, kernel primitives, cross-cutting concerns. See `workflows/designer-first.md`.
- **Story trackers** as coarse GitHub issues, not local handoff files. See `workflows/story-tracker.md`.
- **Feed the SDLC twin on PRs (any repo)** — give `pack-devloop` the signal it can't get from `gh`, by convention in the PR body + a per-PR ritual:
  - **`Producer:` line** — `Producer: <producer>/<model> [skill1, skill2]` (e.g. `Producer: orchestrator/claude-opus-4-8 [brainstorming]`). The producing session is the only thing that knows its own attribution; `backfill` parses it into a producer event. **This is what makes per-producer calibration real instead of `unknown`** — include it on every agent-authored PR.
  - **`Effort:` line** — `Effort: light|standard|deep` — a self-declared, process-anchored tier the `whatif <repo> <indicator> effort` lever stratifies an indicator by *with the model held constant* (so an outcome difference attributes to **effort**, not model). Parsed by `backfill` onto the same producer event as `Producer:`. Optional + non-gating, like `Effect:`. Pick the row matching what the PR **actually got**:

    | Tier | Anchor |
    |---|---|
    | `light` | single pass + one `/code-review` pass (the **review floor** — every PR gets ≥1 adversarial review); no full wave |
    | `standard` | verifier wave (reviewer + qa-engineer + charter-checker) |
    | `deep` | wave + designer-first spec **and/or** ≥2 review rounds |

    Effort is **operator-chosen** (you spend `deep` on harder changes), so the lever ships with a difficulty-confound warning — read a single Δ as a decision aid, not a causal claim (change-type conditioning to de-confound it is a deferred upgrade).
  - **`Effect:` line(s)** — when you can make a *defensible* prediction about a measurable delivery indicator, add `Effect: <indicatorId> <predicted>±<sd> [basis]` (e.g. `Effect: cycle-time 0.01±0.02 expert`). Optional + non-gating (a calibratable claim, never a merge gate). **Prefer the genuinely self-observing indicators — `cycle-time` and `findings`** — `reconcile` derives these from the event log alone (cycle-time from merge latency; findings from PR-scoped verdicts, so `drain <repo#pr>` the wave first), so they score on *any* repo's PR with no external dependency. The SonarQube quality metrics (`coverage`, `maintainability`, `security`, `reliability`, `smells`, `bugs`, `tech-debt`, `duplication`, `complexity`) are observable **only when a Sonar scan brackets the merge with no other merge in the window** — true for `domains/devloop`'s own `ritual:post-merge` (it scans per merge), but NOT for cross-repo PRs (exercir etc.) where scans are sparse and merges batch, so those declarations correctly sit **`deferred`** (the local Community SonarQube has no PR-decorated analysis; `reconcile` now names them). So on a cross-repo PR declare `cycle-time`/`findings`; reach for a Sonar metric only when you'll scan around that merge. **This is the dogfooding lever** — per-producer calibration stays `unknown` until PRs routinely carry *both* `Producer:` and `Effect:` (the calibration loop is built — devloop#2). Declare only what you can defend; the proper score rewards sharpness and penalises vague claims, so **omit rather than guess** (over-declaring scores *worse*, not better) — and note a same-session autonomous merge has `cycle-time` ≈ 0.005–0.01h (seconds-to-minutes), *not* fractions of an hour.
  - **The ritual** (from `domains/devloop`): after merge, ONE command — `npm run ritual:post-merge -- <owner/repo#pr>` — runs the full sequence (drain → backfill → reviews → resolve-findings → coverage → sonar:scan → reconcile → calibration), fail-loud + idempotent, in a single call (devloop#87, token-audit W2); `npm run dev -- retro '{…}'` separately for notable PRs. See `policies/git.md`. **Findings (PR-first):** open the PR *before* the verifier wave; after the wave, write its findings to a temp JSON (`[{verifier, severity, path?, line?, text}]`) and run `… post-findings <repo#pr> findings.json` **before merge** — an inline comment is enough to make the PR harvestable, so the post-merge `… reviews` harvest then records them per-verifier as `FindingRecorded` events, and `… resolve-findings` marks which got addressed (fix-commit linkage) → per-verifier **precision** in `… findings <repo>`. Idempotent (`verifier|path|line`), so a re-run is safe. The `npm run ritual:post-merge` script runs `reviews` + `resolve-findings` automatically.
- **Auto-mode default** — make mechanical calls without asking; escalate only on architectural / scope / convention-contradiction / visible-to-others decisions.
- **Substrate hygiene without substrate ambition** — primitives are substrate-shape; don't market the substrate externally.

## Naming

- GitHub org: `de-braighter` (renamed from `braighter-io` 2026-05-25; old URLs auto-redirect).
- Local cluster + npm scope: `de-braighter` / `@de-braighter`.
- Substrate packages: `@de-braighter/substrate-contracts`, `@de-braighter/substrate-runtime`.
- Domain names: freely chosen per domain. `exercir` (team sports). Working names for prototypes: `conservation`.

## Design references

- **Topology design**: `docs/superpowers/specs/2026-05-24-de-braighter-clean-structure-design.md`
- **Foundation plan** (what scaffolded this): `docs/superpowers/plans/2026-05-24-de-braighter-foundation.md`
- **North-star vision** (substrate framing): `layers/specs/concepts/substrate/north-star-vision-capture-2026-05-17.md` (citable §§3–9, §20, §21).

## What NOT to do

- Don't launch Claude Code from inside `layers/*` or `domains/*` — launch from `de-braighter/` root.
- Don't add code (TypeScript, scripts that build, etc.) to this workbench repo. It's declarative content + design docs only. Code lives in sibling layer/domain repos.
- Don't bypass pre-push hooks (`--no-verify`, sign-bypass).
- Don't market "digital twin platform" or "AWS for systems modeling" externally — the substrate is internal infrastructure per Option A.
