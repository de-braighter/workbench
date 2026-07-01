---
artifact_id: artifact-graph-g3-ready-to-operate-evidence
artifact_kind: evidence
evidence_class: quality
artifact_level: operational
status: draft
authority: local-decision
owner_role: charter-checker
refs:
  supports:
    - de-braighter/workbench:artifact-graph-plan-tree-projection
    - de-braighter/workbench:artifact-graph-foundry-ingestion-handoff
    - de-braighter/workbench:artifact-graph-g0-zero-kernel-change-evidence
    - de-braighter/workbench:artifact-graph-first-cluster-snapshot-review
---

# Artifact Graph G3 Ready To Operate Evidence

## Gate

`G3 - Ready to operate` confirms that Knowledge Slice 0 can now be used as a
read-only artifact graph over the de-braighter cluster. It is an operational
gate, not a new source of truth: the canonical plan remains
`artifact-graph.charter-blueprint.json`, and generated reports remain derived
projections.

## Verification Snapshot

| Field | Value |
|---|---|
| Verification date | `2026-07-01` |
| Workbench base | `1a4f229f83f5bb6a6666cb72b814937ae880caaa` |
| Knowledge main | `df22c7512399d876c5cf1b9f470651a38a812d28` |
| Foundry product | `knowledge-layer/artifact-graph` |
| Ready gate | `G3 - Ready to operate` |

## Gate Checklist

| Check | Evidence | Verdict |
|---|---|---|
| Knowledge `ci:local` | [de-braighter/knowledge#68](https://github.com/de-braighter/knowledge/pull/68) verifier wave and post-merge ritual. Root tests: 263 passed / 4 skipped; contracts: 33 passed; runtime: 108 passed. | Green |
| Markdown quality | G3 runs `npx markdownlint-cli "docs/foundry/knowledge-layer/**/*.md"` in the Workbench G3 worktree. | Green. |
| Zero kernel change | G3 diff is confined to `docs/foundry/knowledge-layer/**`; no path under `layers/substrate/**` changes. | Green |
| Read-only default | Knowledge CLI help and `cli.spec.ts` prove scans write JSON to stdout by default; `--out` is required before report files are written. | Green |
| Secret safety | `secret-safety.spec.ts`, `cli.spec.ts`, and `reports.spec.ts` cover sensitive path exclusion, fail-level diagnostics, and report redaction. | Green |
| Report determinism | [de-braighter/knowledge#68](https://github.com/de-braighter/knowledge/pull/68) sorts report projections and proves equivalent manifests render byte-identical report files. | Green |
| Registration handoff | [de-braighter/workbench#243](https://github.com/de-braighter/workbench/pull/243) registered the first ten Workbench artifacts and verified the focused scan. | Green |
| Foundry ingestion handoff | [de-braighter/workbench#245](https://github.com/de-braighter/workbench/pull/245) added the operating handoff and dependency map aligned to the blueprint. | Green |

## Operating Contract

The Slice 0 operating contract is deliberately small:

- read artifact metadata and citations from source repositories;
- emit snapshot manifests and report projections;
- surface registration, staleness, missing-link, and sensitive-content
  diagnostics;
- keep all generated reports non-authoritative;
- keep Knowledge-specific vocabulary outside the substrate kernel unless a
  future candidate passes ADR-176.

## Remaining Backlog

G3 closes the artifact-graph Slice 0 readiness gate. The remaining work is
follow-up backlog, not a blocker for operating the current artifact graph:

- register the highest-value specs-corpus candidates from E7.1;
- triage pre-existing sensitive-content diagnostics in the Workbench profile;
- design any future automated write-back path separately from Slice 0;
- decide later whether Foundry should ingest the blueprint JSON into durable
  `PlanNode` state once the sync path exists.
