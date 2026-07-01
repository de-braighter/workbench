---
artifact_id: artifact-graph-first-cluster-snapshot-review
artifact_kind: evidence
evidence_class: knowledge
artifact_level: technical
status: draft
authority: local-decision
owner_role: charter-checker
refs:
  supports:
    - de-braighter/workbench:artifact-graph-plan-tree-projection
    - de-braighter/workbench:artifact-graph-slice-0-design
    - de-braighter/workbench:artifact-graph-g0-zero-kernel-change-evidence
---

# Artifact Graph First Cluster Snapshot Review

## Scope

This is the E7.1 dogfood run for `knowledge-layer/artifact-graph`.
It proves that the Knowledge runtime can scan the workbench cluster and
produce handoff material without writing to source repositories.

The raw cluster scan was run from the E7.1 worktree with temporary gitignored
junctions from the worktree's `layers/` and `domains/` folders to the local
sibling repositories. This let the workbench branch content participate in the
scan while keeping the sibling repos read-only.

## Artifacts

| Artifact | Purpose |
|---|---|
| `reports/cluster/artifact-graph-first-cluster-snapshot.json` | Full `knowledge-cluster-scan.v1` JSON report for the local cluster. |
| `reports/workbench/manifest.json` | Repo-local workbench snapshot manifest used for focused review. |
| `reports/workbench/registration-candidates.md` | Workbench registration candidate projection for E7.2. |
| `reports/specs/manifest.json` | Repo-local specs snapshot manifest used for focused review. |
| `reports/specs/registration-candidates.md` | Specs registration candidate projection for E7.2. |
| `reports/knowledge/manifest.json` | Repo-local knowledge snapshot manifest; this run was green. |
| `reports/*/artifacts.json` | Deterministic artifact projections for focused repos. |
| `reports/*/citation-graph.json` | Deterministic citation graph projections for focused repos. |
| `reports/*/stale-report.md` | Deterministic stale snapshot projections for focused repos. |

## Cluster Summary

Generated at `2026-07-01T16:51:16.449Z`.

| Metric | Count |
|---|---:|
| Repositories scanned | 20 |
| Managed artifacts | 51 |
| Artifact snapshots | 4 |
| Citation edges | 5306 |
| Diagnostics | 2323 |
| Cluster-level diagnostics | 0 |
| Fail-level diagnostics | 39 |

The scan emitted valid JSON but exited `1`, because fail-level diagnostics were
present. This is an expected E7.1 dogfood result: the runtime is now exposing
the cluster's registration and hygiene backlog instead of hiding it.

## Diagnostic Triage

| Repo | Artifacts | Edges | Diagnostics | Fail | Main codes |
|---|---:|---:|---:|---:|---|
| `de-braighter/workbench` | 3 | 173 | 681 | 21 | `sensitiveContentDetected`, `missingLinkTargets`, `unregisteredArtifacts` |
| `de-braighter/specs` | 0 | 4142 | 678 | 9 | `sensitiveContentDetected`, `missingLinkTargets`, `unregisteredArtifacts` |
| `de-braighter/exercir` | 3 | 584 | 550 | 1 | `sensitiveContentDetected`, `missingLinkTargets`, `unregisteredArtifacts` |
| `de-braighter/design-system` | 3 | 185 | 141 | 1 | `sensitiveContentDetected`, `missingLinkTargets`, `unregisteredArtifacts` |
| `de-braighter/platform` | 2 | 40 | 47 | 4 | `sensitiveContentDetected`, `missingLinkTargets`, `unregisteredArtifacts` |
| `de-braighter/knowledge` | 4 | 0 | 1 | 0 | `unregisteredArtifacts` |

The previous local `malformedFrontmatter` finding on
`artifact-graph-g0-zero-kernel-change-evidence.md` was fixed in this PR by
adding `evidence_class: quality`.

## Registration Candidates

The first registration pass should start with the docs that have the highest
graph weight and are not yet managed artifacts.

### Specs

| Rank | Score | Path | Signal |
|---:|---:|---|---|
| 1 | 1088 | `adr/adr-176-substrate-kernel-minimality-inclusion-test.md` | 358 inbound discovered links |
| 2 | 703 | `adr/adr-127-kernel-substrate-v1.md` | 233 inbound discovered links |
| 3 | 591 | `concepts/design/north-star-vision-capture-2026-05-17.md` | 189 inbound discovered links |
| 4 | 400 | `adr/adr-154-algebraic-effect-declarations-and-composition-operators.md` | 122 inbound discovered links |
| 5 | 377 | `adr/adr-231-mixture-cure-survival-family.md` | 98 inbound discovered links |

### Workbench

| Rank | Score | Path | Signal |
|---:|---:|---|---|
| 1 | 21 | `docs/superpowers/specs/2026-06-12-adr-draft-tier5-cascade.md` | 21 outbound discovered links |
| 2 | 18 | `docs/superpowers/specs/2026-06-07-substrate-tree-renderer-north-star.md` | 2 inbound and 12 outbound discovered links |
| 3 | 14 | `docs/superpowers/specs/2026-06-18-foundry-v1-P7-browser-runtime-design.md` | 14 outbound discovered links |
| 4 | 14 | `docs/superpowers/specs/2026-06-20-foundry-workflow-cockpit-design.md` | 14 outbound discovered links |
| 5 | 12 | `docs/superpowers/specs/2026-06-19-foundry-observability-dashboard-design.md` | 12 outbound discovered links |

## Handoff To E7.2

E7.2 should use `reports/specs/registration-candidates.md` and
`reports/workbench/registration-candidates.md` as its ordered backlog. The
first valuable move is to register the high-signal specs canon:

1. ADR-176 kernel minimality.
2. ADR-127 kernel substrate v1.
3. North-star vision capture.
4. ADR-154 effect declaration algebra.
5. ADR-027 pack architecture, even though it ranks eighth, because it is a
   standing architecture boundary cited by the workbench instructions.

Do not treat `sensitiveContentDetected` as proof of leaked secrets. The current
finding type is `envAssignment`; several hits are documentation examples that
need review, not automatic deletion. The scanner correctly redacts values and
stores only paths plus finding type.

## Boundary Check

This E7.1 change stays inside `docs/foundry/knowledge-layer/**`. It does not
modify substrate, Knowledge runtime code, or source documents outside the
Foundry handoff area. The raw generated reports are projections from the scan;
they are not the source of truth.
