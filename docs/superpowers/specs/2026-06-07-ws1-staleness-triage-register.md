# WS-1 — staleness triage register (v1, for founder review)

- **Status:** audit complete — **review gate. No edits made.** Founder approves action buckets → WS-1 executes in batched PRs.
- **Date:** 2026-06-07
- **Author:** orchestrator session (3 parallel read-only audit agents)
- **Read-source:** `layers/specs-wt-query-lang` (a current `origin/main` view, HEAD `e8f2805` = origin/main + the 2 additive PR-#279 docs, which were excluded as staleness candidates).
- **Scope:** `layers/specs` only (per the specs-first decision). Tools run: `frontmatter-schema.mjs` (exit 0), `lint-md.sh` (exit 0), corpus link-resolver, per-ADR origin/main code cross-checks.
- **Parent:** `2026-06-07-knowledge-corpus-reorg-design.md` (this is WS-1's output).

## Headline

The corpus is **structurally green where it's governed** (frontmatter + markdownlint both pass, 387 files conform) but **carries heavy reference + naming debt**:

- **~99 dangling cross-references** (BLOCKER) — ~80 of them trace to **one deleted cluster**: the pre-substrate-collapse `foundation-*` + `platform-foundations-*` + `vision-and-strategy-2026` docs. This is the single biggest fault line, and it's **not just broken links — it's a question of whether the surviving referrers are themselves obsolete.**
- **6 ADRs are doc-lag** (`proposed` but shipped) — mechanical status flips.
- **Index drift** — `adr/README.md` prose is 3 ADRs behind; `concepts/README.md` has 1 dead entry + 31 docs on disk it never indexes.
- **Dead-naming is far bigger than `curir`/`verir`** — the brand purge is ~12 files, but the *full* legacy-name footprint (exercir-service, packs-workspace, eyecatcher, braighter-io…) is **hundreds of hits**. This re-sizes WS-3.

Two validators are green (frontmatter ADR-181, markdownlint) — so the rot is in *references, statuses, indexes, and names*, not structure/format.

---

## Bucket A — Doc-lag status flips (6 ADRs) · SAFE-MECHANICAL

`proposed` ADRs verified shipped on `origin/main` (code/PR evidence) — status should flip to `ratified`. Same class as ADR-212.

| ADR | Evidence | Action |
|---|---|---|
| ADR-145 (pack-kids-sports tier-1 invariant) | `exercir@origin/main` manifest sets `substratePosture:'categorical-effects-only'` + passing spec; lib consumed | flip → ratified |
| ADR-147 (year-rhythm phase taxonomy) | `get/set-current-phase` use-cases + phase-card + subtree windows shipped | flip → ratified |
| ADR-195 (core.* schema distribution) | `substrate@origin/main` sql/ artifacts + drift-guards; README says shipped (runtime 0.14.0) | flip → ratified |
| ADR-202 (pack-CRUD `TenantRunner`) | `TenantRunner` port + consumed by pack-football **and** herdbook (≥2 packs, as intended) | flip → ratified |
| ADR-207 (Individual CRUD + TVD uniqueness) | commit `3f56335 feat(lineage): … (ADR-207)`; port carries the 5 methods + `tvd-conflict` | flip → ratified |
| ADR-208 (deleteEdge on LineageRepository) | commit `b68dc32 feat(lineage): deleteEdge … (ADR-208) (#87)` | flip → ratified |

**Correctly `proposed` (keep) — 6:** ADR-144 (consent/Stage-3 deferred v1.1+), ADR-146 (needs a 2nd sport flavor to trigger ratification), ADR-196 (deliberately-parked exploratory), ADR-215 / ADR-216 / ADR-218 (designer-first artifacts awaiting founder OQs). *(The "pack-kids-sports may never have been built" hypothesis was wrong — it's a real, consumed lib.)*

---

## Bucket B — Dangling cross-references (~99) · MIXED

### B1 · The deleted foundation/vision cluster (~80 refs) · NEEDS FOUNDER JUDGMENT

Confirmed intentionally deleted: the `foundation-*` cluster (commit `efa50b2`) and `platform-foundations-overview/roadmap.md` + `vision-and-strategy-2026.md` (commit `4f41dff`, the cascading-structure cut-over). The referrers were never updated.

The judgment isn't "fix the links" — it's **"are the surviving referrers themselves obsolete?"** Many are pre-substrate-collapse vision docs, and the north-star "collapse into one substrate" superseded that whole six-foundation framing. Per-referrer triage needed:

- **Likely obsolete → archive candidates** (pre-collapse framing, dense dead edges): `substrate-vision-layers-generalization-design-constraints.md` (13 dead edges), `recursive-effectful-probabilistic-kernel-synthesis.md` (7), `foundation-event-sourced-kernel.md` (10 — all sibling-foundation edges dead), `foundation-fhir-r5-mcode-export.md` (FHIR demoted by ADR-204), `vision-ladder-n0-to-n4.md`, `kernel-and-pack-architecture-overview.md`, `kernel-connector-framework.md`, `hexagonal-backend-architecture.md`.
- **Keep, but annotate the dead link** (historical ADRs referencing deleted concepts — retain-the-record convention): ADR-031, 077, 089–091, 095, 096, 099.

> **Decision B1:** for the ~8 surviving pre-collapse concept docs — archive the cluster (`concepts/_archive/`) or keep + repair links? This is the meatiest staleness call and I recommend a dedicated per-doc pass (a second audit slice) rather than a blind fix.

### B2 · Stale slugs (file exists, link uses an old/short slug) · SAFE-MECHANICAL

`adr-029-kernel-runtime-nestjs-layering` → `adr-029-kernel-runtime.md`; `adr-170` (bare) → full slug; `adr-160-visual-editor-4th-and-5th-scenes` → full slug; `0076-`/`0077-` zero-padded → `adr-076-`/`adr-077-`. Mechanical find-replace.

### B3 · Legacy repo paths in links · SAFE-MECHANICAL (overlaps WS-3)

`specs/exercir-specs/concepts/...` and `services/exercir-service/...` paths in `prototype-assumptions-charter.md`, `vision-to-bricks-audit-2026-05-16.md`, etc. → current paths.

### B4 · Out-of-corpus paths · NEEDS DECISION (small)

`tools/briefs/...`, `docs/docker.md`, `docs/setup.md`, `.claude/agents/triage.md`, `epics/KAN-090.md`, `_prompts/...` — links to things outside the specs repo (or never-created). Decide: fix, drop, or accept as cross-repo pointers.

### B5 · Path-bugs — file exists, wrong relative path (13) · SAFE-MECHANICAL

ADR `ratifies:` frontmatter using bare concept basenames (resolve from `adr/` → 404; should be `concepts/<name>.md`): ADR-030/031/032/081/082/083/084/121/122. Plus the `concepts/substrate/north-star…` file-relative `../adr/` links that land one level short (targets exist; convention drift). And `ring-model-…:15` → wrong `./` vs `./substrate/`.

---

## Bucket C — Index repair · SAFE-MECHANICAL

- **`adr/README.md`** prose says *"current latest ADR-220; next free 221"* but **221/222/223 exist** (ratified, 2026-06-07) and are unmentioned. *(Frontmatter `next-free-adr: 224` is correct.)* → update prose + add the 3 entries.
- **`concepts/README.md`** — 1 dead entry: `pack-strategy.md` (line 120) no longer exists. → remove.
- **`concepts/README.md`** — **31 docs on disk are unindexed:** all of `concepts/ui/` (21), `concepts/technical-designs/` (2), and 8 standalones — including the load-bearing `prototype-assumptions-charter.md` and `ring-model-and-kernel-boundary-reference.md`. → backfill (same pattern as the substrate-subfolder backfill in PR #279).

---

## Bucket D — Superseded-pointer · MINOR

16/17 superseded ADRs resolve. **ADR-028** points `superseded-by: ["clean-structure-migration-2026-05"]` — a narrative event, not an ADR file (intentional, matches the README, but a graph tool flags it). → accept + add a frontmatter note, or point at a real successor.

---

## Bucket E — Dead-naming (WS-3 preview — re-sizes that workstream)

**`curir`/`verir` (the brand purge):** 16 files. **12 live-rewrite** (`03-strategy.md`, `04-plan.md`, `glossary.md`, `handbook/{glossary,canonical-sets,concept-guide,visual-primer/02-…}.md`, `concepts/README.md`, `pack-architecture-by-sophistication-tier.md`, `vision-to-bricks-audit-2026-05-16.md`, `pack-club-mgmt-first-consumer-mapping.md`, `substrate/sdlc.md`) · **3 historical-leave** (ADR-131/148/151 — covered by adding a `Curir→health`, `Verir→(dropped)` row to the `adr/README.md` naming-legend).

**The bigger surprise — full legacy-name footprint in *live* prose** (excludes historical ADRs):

| Old name | → | Live-prose footprint |
|---|---|---|
| `exercir-service` (paths) | (archived monolith) | **83 files / 454 hits** |
| `braighter-io` (org) | `de-braighter` | 61 files / 272 hits |
| `packs-workspace` | `exercir` | 26 / 209 |
| `eyecatcher(s)` | `brick`/`design-system` (ADR-168) | 24 / 198 |
| `exercir-specs` | `specs` | 34 / 119 *(some self-referential — verify)* |
| `@braighter-io/*` | `@de-braighter/*` | 16 / 74 |
| `de-braighter-eyecatchers` / `braighter-design-system` | `design-system` | 9+6 / 37 |
| `exercir-platform` / `exercir-next` / `the-braighter-specs` | platform / exercir / specs | small |
| `substrate-core` / `substrate-continuum` | (migrated) | **0 — clean** |

> **Decision E:** WS-3 scope — just the `curir`/`verir` brand purge (16 files), or the full legacy-name reconciliation (≈hundreds of hits, esp. `exercir-service`/`braighter-io`/`packs-workspace`/`eyecatcher`)? The brand purge is small; the full sweep is a real project.

---

## Decisions (resolved 2026-06-07)

**Mechanical buckets — APPROVED, executing now** as a single WS-1 PR (subagent): Bucket A (6 doc-lag flips) · B2 (stale slugs) · B5 (13 path-bugs) · C (index repair).

1. **B1 → dedicated obsolescence pass.** The surviving pre-collapse concept docs get a focused read-only audit slice deciding *per doc* — archive vs keep+repair vs keep-as-historical — with evidence measured against the current framing (north-star §9 collapse, ADR-127 four concerns, ADR-204 FHIR demotion). Output = a recommendations register for founder review; the B1 link/archive remediation is a *separate* PR. (NOT a wholesale archive.)
2. **B4 → triage each.** Per out-of-corpus link: fix where a real target exists, drop the truly dead/placeholder ones. Small follow-on task (the mechanical PR deliberately left these alone).
3. **WS-3 scope → brand + clean 1:1 renames.** `curir`/`verir` purge + the unambiguous org/scope/repo renames in live prose (frozen ADRs left, covered by naming-legend rows). **DEFER** the 2 judgment-heavy ones — `exercir-service` path refs (454 hits, overlaps the B1 obsolescence work) and `eyecatcher→brick` (ADR-168 conceptual rename) — to a later pass.

## Next step

- **WS-1 mechanical PR** (A/B2/B5/C) — executing (subagent) → PR incoming.
- **B1 obsolescence pass** — running (read-only) → recommendations register for review.
- Then: **B1 remediation PR** (per reviewed recommendations) + **B4 triage**, then **WS-2** (tiering reorg) and **WS-3** (brand + 1:1 naming) on the de-staled corpus.
