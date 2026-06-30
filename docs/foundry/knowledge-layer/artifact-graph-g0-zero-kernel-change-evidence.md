---
artifact_id: artifact-graph-g0-zero-kernel-change-evidence
artifact_kind: evidence
artifact_level: technical
status: draft
authority: local-decision
owner_role: charter-checker
refs:
  supports:
    - de-braighter/workbench:artifact-graph-plan-tree-projection
    - de-braighter/workbench:artifact-graph-slice-0-design
---

# Artifact Graph G0 Zero Kernel Change Evidence

## Gate

`G0 - Zero kernel change` confirms the Kernel-Untouched Invariant for the
Knowledge Layer Artifact Graph plan:

- no substrate production file is changed;
- no knowledge vocabulary is added under `layers/substrate` production code;
- artifact graph vocabulary remains in the Knowledge layer and its Foundry docs.

## Evidence

This G0 proof is docs-only in the workbench repository. The intended diff is
confined to:

```text
docs/foundry/knowledge-layer/**
```

The current Knowledge layer was reconciled as an existing sibling repository,
not scaffolded into the workbench or the substrate. Its verified local state is:

```text
repo: de-braighter/knowledge
local: layers/knowledge
head: 56cbce5 feat(knowledge): async twin + KnowledgeAssessor injectable scorer seam (#21)
```

E0.2 verification already proved the existing Knowledge layer builds without a
kernel change:

```text
pnpm install --frozen-lockfile
pnpm run ci:local
```

The successful `ci:local` run covered Prisma generation, TypeScript, and Vitest
for the Knowledge layer: 30 test files passed, 249 tests passed, with the
database-gated pgvector integration spec skipped when DB env was unset.

## Boundary Decision

Artifact graph concepts are Knowledge-layer vocabulary. They must not be
promoted into the substrate kernel unless the ADR-176 inclusion test is met:

1. the candidate belongs to one of the four kernel concerns;
2. at least two packs need it as shared infrastructure the kernel must validate,
   query, or version.

The current artifact graph work does not meet that promotion threshold. It is a
pack/layer concern over existing substrate primitives:

- plan tree nodes carry knowledge metadata;
- citations, snapshots, retrieval indexes, and staleness reports are derived or
  layer-owned artifacts;
- the substrate remains the provider of published contracts and runtime ports,
  not the owner of Knowledge-specific vocabulary.

## Required Checks

Before G0 can be marked built, the PR must show:

- `git diff --name-only origin/main...HEAD` contains only
  `docs/foundry/knowledge-layer/**`;
- no diff path starts with `layers/substrate/`;
- no production file under `layers/substrate` contains new Knowledge artifact
  graph vocabulary from this branch;
- Markdown in `docs/foundry/knowledge-layer` lints cleanly;
- the blueprint JSON still validates as one rooted plan with no missing parent
  or dependency references.
