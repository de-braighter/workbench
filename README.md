# de Braighter Workbench

The cluster root + Claude-Code-native workbench for the de Braighter ecosystem.

This repository is both:

1. **A git repo** (`de-braighter/workbench`) holding canonical `.claude/agents/`, `.claude/skills/`, policies, templates, workflows, and project descriptors.
2. **The cluster root** — sibling layer + domain + attic repos clone into `layers/`, `domains/`, and `attic/` (each with its own `.git`, ignored at this repo's level).

Claude Code is **always launched from this directory**. `.claude/` here applies to all work across the cluster.

## Layout

```
de-braighter/                     ← this repo
├── .claude/                      ← canonical agents, skills, settings
├── policies/                     ← coding, testing, git, docs, voice
├── templates/                    ← adr, concept, story, pr, sprint
├── workflows/                    ← verifier-wave, designer-first, story-tracker
├── projects/<key>/project.yaml   ← per-domain descriptors (metadata only)
├── docs/superpowers/             ← design specs + implementation plans
├── layers/                       ← cluster dir: sibling layer repos (gitignored here)
├── domains/                      ← cluster dir: sibling domain repos (gitignored here)
└── attic/                        ← preservation repo (gitignored here)
```

## Foundation status

This repo was scaffolded on 2026-05-24 per `docs/superpowers/specs/2026-05-24-de-braighter-clean-structure-design.md`. Layer and domain repos are not yet scaffolded — see `docs/superpowers/plans/` for the migration plans.
