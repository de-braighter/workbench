# Knowledge-corpus reorganization — program design

- **Status:** design — structural foundation DECIDED (the three-tier taxonomy + identity rule); workstream detail + three open decisions remain.
- **Date:** 2026-06-07
- **Author:** orchestrator session (founder-directed brainstorming)
- **Scope anchor:** OPEN — `layers/specs`-first vs whole-cluster (see §6.1). Default working assumption: specs-first.
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
- **Tier 1 & 2 stay in `layers/specs`**, sorted — either into folders (`specs/charter/` vs `specs/design/`) or by tag alone. *(Folder-vs-tag is open — §6.4.)*

So **the number carries identity; the tag + location carry the tier.** No cross-ref breakage.

## 4. Workstreams + ordering

**Order: Staleness → Locality → Naming.** Structural rationale (reinforces the founder's priority): you do not want to carefully *relocate* and *rename* garbage. De-stale first, reorganize the survivors, rename last — otherwise dead names (`curir`) propagate into the new structure and effort is spent moving docs that should have been archived.

- **WS-1 · Staleness (first, most crucial).** An **audit that produces a reviewed triage register**, not blind edits — because these are load-bearing cross-refs in a PR-gated repo, superseded ADRs are deliberately *retained* with pointers, and the ADR-212 trap (looks stale but isn't, or vice-versa) is real. Register classifies each doc: `status-doc-lag` / `superseded-but-unmarked` / `contradicts-live-code` / `dead-naming` / `archive` / `leave`. Founder reviews → batched fix PRs.
- **WS-2 · Locality (the tiering reorg).** Apply §3: stamp `tier:`/`scope:` on every surviving doc, update the ADR-181 schema + validator, sort tier-1/2 in `specs`, relocate tier-3 → domain repos with redirect stubs, and execute the long-pending `concepts/` subfolder reorg. Depends on WS-1 (only move survivors).
- **WS-3 · Naming.** Reconcile `curir`/`verir` → the real domain set (`exercir` / `health` / `conservation` / `herdbook` / `markets` / `devloop`), decide the `-ir` brand question (dead vs retained marketing brand — §6.3), and propagate canonical names. Last, so it lands on a clean, de-staled, reorganized corpus.

Each workstream is its own spec → plan → execution cycle (subagent-driven execution per standing practice).

## 5. Quick wins (independent of the workstreams)

- **Orphaned worktrees/clones** cluttering the cluster root: `layers/specs-wt-206`, `layers/specs-prosefix-wt`, `layers/substrate-ws4`, `domains/markets-prepush-wt` (plus this session's transient `layers/specs-wt-query-lang`, retained until PR #279 merges, and this workbench worktree). Sweep after confirming none hold unpushed work.
- **`domains/health` holds 1 doc** while the oncology design sits in `specs/concepts/` — a concrete tier-3 relocation candidate for WS-2.

## 6. OPEN decisions (to resolve before the workstreams)

1. **Scope boundary.** `layers/specs`-first (578 docs — the epicenter; per-repo docs as fast-follow) **vs** whole-cluster (~1000+ at once). Lean: specs-first.
2. **Staleness definition + approach.** Audit-first reviewed register (recommended) vs fix-as-found; and what counts as "stale" — `contradicts-live-code` only, or also `obsolete-but-harmless` (dead `-ir` branding, never-built `verir` docs, pre-pivot framing) and `superseded-but-unmarked`.
3. **Naming / brand.** Is **`Curir`/`Verir`** a *dead name* (purge) or a *retained marketing brand* over a domain (keep, distinct from the repo name, as `Exercir` is over `exercir`)? Founder's call — gates WS-3.
4. **Tier-1/2 physical separation.** Folders (`specs/charter/` vs `specs/design/`) vs tag-only sorting. Affects path-based cross-refs.

## 7. Next step

Resolve §6 (esp. scope boundary + staleness approach), then open **WS-1**: dispatch the staleness audit (build on the `spec-auditor` agent + targeted readers) to produce the triage register for founder review.
