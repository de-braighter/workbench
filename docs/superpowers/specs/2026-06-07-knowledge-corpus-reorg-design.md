# Knowledge-corpus reorganization — program design

- **Status:** design — structural foundation DECIDED (the three-tier taxonomy + identity rule); workstream detail + three open decisions remain.
- **Date:** 2026-06-07
- **Author:** orchestrator session (founder-directed brainstorming)
- **Scope:** DECIDED (2026-06-07) — `layers/specs`-first; per-repo docs (design-system, domains) are fast-follow passes.
- **Related:** `layers/specs/concepts/README.md` §Pending (the long-deferred `substrate/` → `abstract-models/` + `packs/` reorg this program executes) · ADR-181 (frontmatter governance — the schema gains `tier:`/`scope:`) · ADR-148 (cross-repo pack-split policy — relocating tier-3 to domains) · the substrate coherence remediation program (the WS-1…WS-9 precedent this mirrors).

---

## 1. What this is

A reorganization **program** (not a task) for the de Braighter knowledge corpus. The founder named three problems, in increasing order of importance:

1. **Naming** — legacy `-ir` brand labels (`Curir`/`Verir`) vs the real domains; ~110 stale `curir` mentions.
2. **Locality** — "stuff spread that belongs together": the flat `concepts/` dir, the never-executed subfolder reorg, domain design docs sitting in the central knowledge layer.
3. **Staleness (most crucial)** — documents that are wrong / contradict live code / are superseded-but-unmarked / carry dead names. The dangerous, hard-to-detect class.

Too large for one spec → decomposed into ordered workstreams (§4). The structural foundation that the locality + naming work both depend on — **how the corpus is tiered** — is decided here (§3).

## 2. Scale (recon, 2026-06-07)

| Where | Docs | Note |
|---|---|---|
| `layers/specs` | **578** | 214 ADRs · 166 concepts · 19 handbook · 21 enterprise — the epicenter |
| `layers/design-system` | 347 | component/showcase docs |
| `domains/exercir` | 105 | |
| `domains/herdbook` | 79 | |
| `layers/substrate` | 75 | |
| `domains/health` | **1** | the active second brick — its design lives in `specs/concepts`, a locality finding |
| workbench `docs/` | 105 | + 30 superpowers specs, 72 plans |

**ADR status distribution:** 214 ADRs = 181 ratified · 17 superseded · **15 proposed** (ADR-212 was a proposed-but-shipped doc-lag case until 2026-06-07; the 15 are prime staleness suspects).

## 3. DECIDED — the three-tier taxonomy (structural foundation)

The corpus is sorted into **three tiers** by a single test per tier. The charter becomes legible (a few dozen binding decisions instead of 214 undifferentiated ones); implementation detail lives by scope.

| Tier | What it is | The test | Home |
|---|---|---|---|
| **1 · Charter ADR** | Constitutional, cluster-wide decision | *"If this changed, would the system stop being Substrate, or would a cross-pack invariant break?"* — the things `charter-checker` enforces | central — `layers/specs` |
| **2 · Design note, global** | Substrate-wide *how* — applies across packs/runtime, not constitutional | *"Global reach, but a mechanism/implementation choice, not an invariant"* | central — `layers/specs` |
| **3 · Design note, local** | Scoped to one domain | *"Only this domain cares"* | **the domain repo** (`domains/<d>/…`) |

**Illustrative mapping** (not yet audited — WS-1 produces the authoritative classification):

- **Charter:** ADR-176 (kernel minimality), 127 (four concerns), 027 (pack-on-platform), 110 (hex ports), 154 (effect algebra), 184 (consent), 187 (ontology invariants), 189 (AI-safety ladder), 220 (reproducibility), the ring model. → *a charter core of a few dozen.*
- **Global design:** ADR-195 (schema distribution), 200 (effect persistence), 205/206/212 (inference wiring), `prisma-migration-spec`, most substrate concept docs. → ***the bulk.***
- **Local design:** the football cluster (ADR-156–172), 207 (herdbook TVD), `pack-football-*` concepts, the oncology/health design docs (→ `domains/health`). → *~20–30.*

### 3.1 Consequence (intentional)

This reclassifies the **majority** of today's 214 ADRs out of "ADR" and into "design note." That is the point — it makes the charter legible. A tier-2/3 design note **may still be written as a decision record** (context / alternatives / consequences); it is simply *not charter*.

### 3.2 DECIDED — identity & numbering ("approach is fine")

The 214 ADRs are cross-referenced across all ~1000+ docs, in code comments, in CLAUDE.md, in memory. Renumbering into per-tier namespaces would break every reference cluster-wide — rejected. Instead:

- **`ADR-NNN` stays the permanent, never-reused global key** (exactly as today). The number is the universal handle.
- Every doc gains **`tier:`** (`charter` / `design-global` / `design-local`) and **`scope:`** (`cluster` / `substrate` / `<domain>`) frontmatter. *(This extends the ADR-181 frontmatter schema → the validator `tools/validators/frontmatter-schema.mjs` must be updated, and ADR-181 amended.)*
- **Only tier-3 docs physically relocate** into their domain repo (e.g. `domains/exercir/adr/adr-156-*.md`), each leaving a **one-line redirect stub** in `specs/adr/` (`moved-to: domains/<d>/...`) so number-references and links still resolve.
- **Tier 1 & 2 stay in `layers/specs`**, sorted into **separate folders** — `specs/charter/` (tier 1) and `specs/design/` (tier 2). *(DECIDED 2026-06-07: folders, not tag-only — the folder is a fast visual + path signal on top of the `tier:` tag.)*

So **the number carries identity; the tag + location carry the tier.** No cross-ref breakage.

## 4. Workstreams + ordering

**Order: Staleness → Locality → Naming.** Structural rationale (reinforces the founder's priority): you do not want to carefully *relocate* and *rename* garbage. De-stale first, reorganize the survivors, rename last — otherwise dead names (`curir`) propagate into the new structure and effort is spent moving docs that should have been archived.

- **WS-1 · Staleness (first, most crucial).** An **audit that produces a reviewed triage register**, not blind edits — because these are load-bearing cross-refs in a PR-gated repo, superseded ADRs are deliberately *retained* with pointers, and the ADR-212 trap (looks stale but isn't, or vice-versa) is real. **Broad staleness definition (DECIDED 2026-06-07):** all of `status-doc-lag` / `superseded-but-unmarked` / `contradicts-live-code` / `dead-naming` / `obsolete-but-harmless` are in scope, plus `archive` / `leave`. Register classifies each doc into one. Founder reviews → batched fix PRs.
- **WS-2 · Locality (the tiering reorg).** Apply §3: stamp `tier:`/`scope:` on every surviving doc, update the ADR-181 schema + validator, sort tier-1/2 in `specs`, relocate tier-3 → domain repos with redirect stubs, and execute the long-pending `concepts/` subfolder reorg. Depends on WS-1 (only move survivors).
- **WS-3 · Naming.** **Purge** the dead `-ir` brand labels — `Curir`/`Verir` are dead names, **not** retained brands (DECIDED 2026-06-07) — reconciling every reference to the real domain set (`exercir` / `health` / `conservation` / `herdbook` / `markets` / `devloop`). ~110 `curir` mentions + the `verir` set + the README's `Care-cluster (Curir)` / `Association-cluster (Verir)` taxonomy + the `packs/{exercir,curir,verir}/` reorg plan. Last, so it lands on a clean, de-staled, reorganized corpus. (Historical ADRs keep their original wording per the README naming-legend convention — *names are not rewritten in place where that would falsify the record*; the purge targets live taxonomy/indexes/prose, not frozen decision records. The audit register marks which dead-naming hits are "live, rewrite" vs "historical, leave + legend".)

Each workstream is its own spec → plan → execution cycle (subagent-driven execution per standing practice).

## 5. Quick wins (independent of the workstreams)

- **Orphaned worktrees/clones** cluttering the cluster root: `layers/specs-wt-206`, `layers/specs-prosefix-wt`, `layers/substrate-ws4`, `domains/markets-prepush-wt` (plus this session's transient `layers/specs-wt-query-lang`, retained until PR #279 merges, and this workbench worktree). Sweep after confirming none hold unpushed work.
- **`domains/health` holds 1 doc** while the oncology design sits in `specs/concepts/` — a concrete tier-3 relocation candidate for WS-2.

## 6. Resolved decisions (2026-06-07)

All four open decisions are resolved (founder-directed):

1. **Scope boundary → `layers/specs`-first.** 578 docs (the epicenter). Per-repo docs (design-system 347, exercir 105, substrate 75, herdbook 79, …) are fast-follow passes once the pattern is proven.
2. **Staleness → audit-first reviewed register, broad definition.** No edits before the founder sees the register; "stale" spans doc-lag / superseded-unmarked / contradicts-live-code / dead-naming / obsolete-but-harmless.
3. **`Curir`/`Verir` → purge.** Dead names, not retained brands. (Only `Exercir` == its domain; the care cluster is `health`, the association cluster never became a domain.)
4. **Tier-1/2 → separate folders.** `specs/charter/` (tier 1) and `specs/design/` (tier 2), on top of the `tier:` tag.

## 7. Next step — WS-1 is open

The staleness audit is running against a current `origin/main` view of `layers/specs`, in three slices, producing a **v1 triage register for founder review before any edits**:

- **structural staleness** (`spec-auditor`): dangling cross-refs, numbering collisions, superseded-pointer integrity, frontmatter conformance, stale index entries — corpus-wide.
- **doc-lag** (code-reading agent): the 15 `proposed` ADRs — which shipped but still read `proposed` (the ADR-212 class) vs genuinely in-flight.
- **dead-naming** (grep sweep): `curir`/`verir` + other legacy renames, per-file, split live-rewrite vs historical-leave.

Register lands here for review; then WS-2 (locality/tiering) and WS-3 (naming purge) execute against the de-staled survivors.
