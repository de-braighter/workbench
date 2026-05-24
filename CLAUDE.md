# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

`D:/development/projects/de-braighter/` is **both**:

1. The git repo `braighter-io/workbench` — canonical `.claude/agents/`, `.claude/skills/`, settings, policies, templates, workflows, project descriptors, and design docs.
2. The cluster root — sibling layer + domain + attic repos clone into `layers/`, `domains/`, and `attic/`.

**Claude Code is always launched from this directory.** `.claude/` here applies to all work across the cluster. Do not launch Claude Code from inside a sibling repo (you would lose access to the agents and skills).

## Layout

```
de-braighter/                     ← this repo (braighter-io/workbench)
├── .claude/
│   ├── agents/                   ← 22 canonical agent definitions
│   ├── skills/                   ← 39 canonical skill folders
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
│   └── platform/
├── domains/                      ← cluster: sibling domain repos (gitignored here)
│   ├── exercir/
│   ├── conservation/
│   ├── vector/
│   └── org-twin/
└── attic/                        ← preservation repo (gitignored here)
```

## What's scaffolded today (2026-05-24 foundation)

- The workbench repo itself (this repo) with canonical `.claude/`, policies, templates, workflows, project descriptors, and design docs.
- **Not yet scaffolded:** any layer or domain repo. They come via follow-up plans in `docs/superpowers/plans/`.

The current Exercir / substrate / design-system / specs / platform code still lives in the prototype directories at `D:/development/projects/braighter/` and `D:/development/projects/exercir/`. Migration is incremental, per follow-up plans.

## Workflow rules

- **PR-gated everywhere**, including specs/ADRs. No direct-to-main. See `policies/git.md`.
- **Verifier wave** (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`, in parallel, all with `isolation: "worktree"`) on every non-trivial PR. See `workflows/verifier-wave.md`.
- **Designer-first** for risky changes — new ports, kernel primitives, cross-cutting concerns. See `workflows/designer-first.md`.
- **Story trackers** as coarse GitHub issues, not local handoff files. See `workflows/story-tracker.md`.
- **Auto-mode default** — make mechanical calls without asking; escalate only on architectural / scope / convention-contradiction / visible-to-others decisions.
- **Substrate hygiene without substrate ambition** — primitives are substrate-shape; don't market the substrate externally.

## Naming

- GitHub org: `braighter-io` (kept for now; future migration TBD).
- Local cluster + npm scope: `de-braighter` / `@de-braighter`.
- Substrate packages: `@de-braighter/substrate-contracts`, `@de-braighter/substrate-runtime`.
- Domain names: freely chosen per domain. `exercir` (team sports). Working names for prototypes: `conservation`, `vector`, `org-twin`.

## Design references

- **Topology design**: `docs/superpowers/specs/2026-05-24-de-braighter-clean-structure-design.md`
- **Foundation plan** (what scaffolded this): `docs/superpowers/plans/2026-05-24-de-braighter-foundation.md`
- **North-star vision** (substrate framing): see the existing copy at `D:/development/projects/exercir/exercir-workbench/specs/exercir-specs/concepts/substrate/north-star-vision-capture-2026-05-17.md` until specs is scaffolded.

## What NOT to do

- Don't launch Claude Code from inside `layers/*` or `domains/*` — launch from `de-braighter/` root.
- Don't add code (TypeScript, scripts that build, etc.) to this workbench repo. It's declarative content + design docs only. Code lives in sibling layer/domain repos.
- Don't bypass pre-push hooks (`--no-verify`, sign-bypass).
- Don't market "digital twin platform" or "AWS for systems modeling" externally — the substrate is internal infrastructure per Option A.
