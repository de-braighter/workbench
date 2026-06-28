---
title: "knowledge — a shared document/artifact layer on substrate (the knowledge twin)"
status: design (pre-scaffold) — for review
kind: technical-design
created: 2026-06-28
author: stibe
relates-to:
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - layers/specs/adr/adr-127-kernel-substrate-v1.md
  - layers/specs/adr/adr-154-algebraic-effect-declarations-and-composition-operators.md
  - layers/specs/adr/adr-200-effect-declaration-persistence-jsonb-on-plan-node.md
  - layers/specs/adr/adr-027-pack-architecture.md
  - layers/specs/adr/adr-110-hexagonal-ports-and-adapters-convention.md
  - layers/specs/adr/adr-283-charter-runtime-cluster-layer.md
  - layers/specs/adr/adr-234-skin-system-floor-data-skin-scoping-pack-token-contract.md
  - layers/specs/adr/adr-279-board-kit-calc-expression-value.md
  - docs/superpowers/specs/2026-06-17-foundry-substrate-self-application-design.md
  - docs/superpowers/specs/2026-06-03-markets-external-source-integration-design.md
  - docs/superpowers/specs/2026-05-31-sdlc-knowledge-graph-read-side-design.md
  - docs/superpowers/specs/2026-06-01-sdlc-knowledge-graph-write-side-design.md
  - docs/superpowers/specs/2026-06-07-knowledge-corpus-reorg-design.md
note: >
  Brainstormed design (superpowers:brainstorming). A shared, domain-agnostic
  document/artifact-management CLUSTER LAYER ("knowledge") modelled on the substrate
  kernel with ZERO kernel change (ADR-176). A knowledge corpus is a plan tree of
  knowledge nodes; references are the second (citation) graph; specialization is by
  pack-skin (wording + declarative behaviour), strictly separate from theme-skin
  (visual). Origin is foundry: extract foundry's artifact+reference+version core into
  the layer; foundry becomes the first consumer (the architecture-knowledge pack-skin).
  Blueprints are another pack-skin (definition), with execution owned by charter-runtime,
  joined by the `instantiates` reference edge. Revised after charter-checker +
  spec-auditor review. Implementation plan (superpowers:writing-plans) follows founder
  review of this spec.
---

# knowledge — a shared document/artifact layer on substrate

> **The move.** Everything here keeps becoming a plan tree — so a knowledge corpus
> is just a plan tree whose nodes decompose *knowledge* instead of *action*. Model
> it as a shared, domain-agnostic cluster layer on the existing kernel (plan tree,
> event log, inference, pgvector), give it a *second* graph for references
> (citations), and let the kernel's own principle — **store generators, derive
> graphs** — produce the two outputs that matter: **minimal, valid AI context packs**
> and **"nothing silently goes stale."** Specialize per domain with a **pack-skin**
> (wording, declarative behaviour). Zero kernel change. Origin is **foundry** — it
> already manages versioned, cross-referenced artifacts, so the layer is *extracted
> from a demonstrated need*, not invented.

---

## 0. Provenance & motivation

Two brainstorms feed this:

1. This session (superpowers:brainstorming) — drove the persistence question ("is
   Postgres still right for plan trees, is there better tech?") to its answer:
   **PG is the answer, because "model with substrate" *is* "persist in substrate,"**
   and the single-parent + derive-don't-store discipline is exactly what removes the
   need for a graph database. The one *additive* technology is `pgvector` (semantic
   retrieval), inside the same Postgres.
2. The founder's "Organizational OS / Diamond / Hydra" chat (Codex). Most of that
   transcript is vision and go-to-market (Organizational OS, ERP-as-projection, Club
   OS, the Hydra brand) and is **deliberately out of scope here**. Two load-bearing
   design statements survive into this spec:
   - *"Das knowledge pack wird wohl als Abfallprodukt von foundry entstehen."* —
     foundry is the **first consumer** (see §7). *Correction after codebase
     investigation (writing-plans S0):* foundry has **no document/citation store** to
     extract — the document core is built NEW; only a substrate-free content-hash util
     moves; foundry's blueprint/version bits are cataloged for the §8 follow-on. The
     "demonstrated need" lives at the cluster-corpus level (specs/ADRs that go stale by
     hand today), with foundry as the first consumer.
   - *References as artifact metadata enable inference: "what happens if I delete
     document N? where is it cited, and which citations must change when the basis
     changes?"* plus **tree-as-context-navigation** → smaller token cost, higher
     quality (see §4, §6).

**Calibration carried from that chat (do not over-claim):** "FHIR-ready" is recorded
as *FHIR-aligned / extension path* until real adapters exist; "near-100% coverage"
applies to the *kernel*, not globally.

The deeper problem the layer attacks: a document today is isolated text. Change, move,
or delete it and nobody knows what broke. AI agents pay for that by hoovering broad
context (the lever behind expensive large-context models) instead of receiving the
*minimal valid* context. The layer turns documents into nodes with **change effect**.

---

## 1. The core reframe — one tree, knowledge nodes

A knowledge corpus is a plan tree (`kernel.plan_node`) whose nodes carry *knowledge*,
not *interventions*:

- **Shared shape, not shared concept.** What is common with a runtime plan node is
  the structural spine — a single-parent recursive tree of typed nodes with `title`,
  `description`, `metadata`. What is *not* shared: a runtime node's load-bearing
  semantics are its effect declarations (the typed effect-declaration algebra,
  ADR-154/ADR-200); a knowledge node has **no effect declarations** (the contract
  field `effectDeclarations` is `.optional()`, so it is simply absent). Knowledge
  shape (summary, content pointer, citations, lifecycle) lives in `metadata`. This is
  the same `kind` + `metadata` extension discipline the kernel applies to itself, and
  the same move the recursive charter-runtime arc already made (one `CharterNode` =
  `PlanNode` + a contract on `metadata`; ADR-283).
- **Two graphs on one node table** (see §4): the **containment tree** (`parent_id`,
  single-parent decomposition) and the **reference graph** (citation edges,
  many-to-many). References are the constitution's sanctioned escape hatch —
  *"cross-links, if ever needed, are a separate relation, never multi-parent."*

---

## 2. Decisions

- **D1 — It is a cluster *layer*, not a kernel concern (and not a domain pack).**
  Document management is a *capability built from* the four kernel concerns (doc tree
  = recurse the plan; edits = flat the observation; freshness = inference; versions =
  reproducibility), not a fifth concern — it fails part (a) of the ADR-176 inclusion
  test, so it stays outside the kernel. And because it is consumed across ≥2 domains
  (foundry, exercir, studio…), it cannot be a Ring 4/5 *domain pack* — domains may not
  import each other (ADR-027), so cross-domain shared infrastructure must be a
  **cluster layer** (`layers/knowledge`, published `@de-braighter/*`), exactly like
  `charter-runtime` and `design-system` (ADR-283 precedent). **Zero kernel change.**
- **D2 — Persistence is substrate/Postgres.** Containment in `plan_node`; observations
  in `event_log`; posteriors via the inference backbone; retrieval index via
  `pgvector` (additive, same DB, layer-owned table). No graph database; no second
  datastore.
- **D3 — References are stored as generators, graphs are derived.** Each node's
  *outbound* citations are stored in `metadata.cites[]` (the generator); the
  **backlink index** and **impact set** are derived, rebuildable views, never
  authoritative state. The derived index is never the authoring surface — citations
  are authored into `metadata.cites[]` and the index is derived *from* them.
- **D4 — Content lives behind a pluggable content port.** The layer stores the node
  (tree position, metadata, citations, lifecycle) plus a *content reference* in
  `metadata.contentRef`; the bytes live behind a `ContentPort` with adapters (git /
  object-store / FHIR-EPD). Hexagonal per ADR-110. (We do **not** reuse the kernel's
  `plan_node.importRef` column: it is not exposed by the published `PlanNodeSchema`,
  not round-tripped by `PrismaPlanTreeStore`, and already reserved for subtree-registry
  provenance — using it would force kernel changes and break the zero-change claim.)
- **D5 — Specialization is by pack-skin.** A *pack-skin* declares wording +
  declarative behaviour (kinds, lifecycle states, citation rules, content-adapter
  choice). It is **strictly separate** from a *theme-skin* (visual; design-system,
  ADR-234). The two share only the finished product; they are authored, owned, and
  versioned independently. (Naming: "skin" is overloaded in the cluster — this spec
  fixes the split: `theme-skin` = visual, `pack-skin` = wording + behaviour.)
- **D6 — Behaviour is declarative-only.** A pack-skin's behaviour is config + bounded
  extension-point selection + the ADR-279 pure-data expression language where real
  logic is needed. **Never shipped code.** The moment a skin ships code it is a
  sub-pack, not a skin (keeps "as simple as possible but as complex as required").
- **D7 — Tenancy is parametric.** Domain corpora are tenant data → RLS-scoped by
  `tenant_pack_id` (the canonical posture; `plan_node.tenant_pack_id` is NOT NULL +
  dual USING/WITH-CHECK RLS). The cluster's *own* knowledge is vendor/global — but
  because `plan_node` is always tenant-scoped, that means a **reserved vendor-tier
  `tenant_pack_id`** (the vendor-tier convention), *not* the literally-unscoped
  posture of the kernel's own catalog tables (`kernel.mechanism` etc. are kernel-owned
  tables with their own posture; a knowledge corpus is layer-owned `plan_node` rows).
  The kernel supports both ends; the layer picks the scope per consumer.
- **D8 — Foundry is the first consumer; the document core is built new (Approach #1, revised).**
  Codebase investigation (writing-plans S0) found foundry has **no document/citation
  store** to extract (append-only event log + derived blueprints; unindexed
  `metadata.crossRefs`; generation-run hashes). So the S1 document core
  (`contentRef`/`cites[]`/`whoCites`/pgvector) is **built new**; the only move-able
  primitive is a substrate-free content-hash util (`canonicalJson`+`sha256Hex`).
  Foundry becomes the first **pack-skin** (the architecture-knowledge cascade, §7) —
  the first *consumer*, not the extraction source. "Promote from demonstrated need"
  still holds at the cluster-corpus level + foundry's blueprint/version pillar.
- **D9 — Build order is retrieval → assessment → provenance.** This is the order in
  which the kernel concerns layer on *without rework* (§6).
- **D10 — Blueprints are another pack-skin (definition), not a new subsystem.** A
  blueprint's *definition* is a `knowledge` pack-skin; its *execution* (instantiate /
  deviate / improve) is owned by `charter-runtime`; the two are joined by the
  `instantiates` reference edge (§8). `knowledge` does not implement instantiation
  runtime.

---

## 3. Architecture

```text
knowledge (cluster layer — layers/knowledge, published @de-braighter/*)
  composes ──> @de-braighter/substrate-contracts + substrate-runtime
                 plan_node (containment tree)      [concern 1]
                 event_log (observations)          [concern 2]
                 inference backbone (posteriors)   [concern 3]
                 run_manifest / event-sourcing     [concern 4]
                 pgvector index (derived, layer-owned table)  [additive retrieval]
  ports ──────> ContentPort  { git | object-store | fhir }  (bytes)
  pack-skin ──> wording + declarative behaviour (kinds, lifecycle, citation rules)
  theme-skin ─> (separate) design-system visual layer — NOT part of this layer
```

- **A knowledge node** = `plan_node` with `kind = "knowledge.<kind>"` (plus the
  contract-required `kindRef` pointing into the skin's kind catalog), **no
  `effectDeclarations`**, and the contract nested under **`metadata.knowledge`**
  (mirroring `metadata.charter` — avoids collisions with kernel-reserved metadata keys):

  ```jsonc
  {
    "knowledge": {
      "summary": "…",                      // abstract for retrieval
      "contentRef": { "adapter": "git", "locator": "layers/specs/adr/adr-176-…md" },
      "cites": [ { "target": "<ref>", "relation": "derivedFrom", "locator": "§Methods" } ],
      "lifecycle": "draft|active|superseded|archived",
      "skin": "architecture-knowledge",    // which pack-skin gives this node meaning
      "embeddingRef": "<vector id>"        // derived; pgvector row pointer (layer-owned)
    }
  }
  ```

  (Throughout this spec, `metadata.cites[]`, `metadata.contentRef`, etc. are shorthand
  for the nested `metadata.knowledge.*` form shown here.)
- **Tenancy / RLS** as D7. **Zero kernel change** as D1 (everything rides `metadata`
  - the published plan-tree port; no kernel column or schema is touched).
- **pgvector is not yet installed in the dev Postgres** (S1's top execution risk) —
  but the document-persistence core (tree + `contentRef` + `cites`/`whoCites`) does
  **not** depend on it; only S2 semantic retrieval does. Enabling the extension is a
  `layers/platform` step, not a kernel change.

---

## 4. The reference graph & impact analysis (the second graph)

References are first-class — the productized, *live* version of what `spec-auditor`
does by hand today (stale ADR refs, dangling concept links).

- **Stored generator:** `metadata.cites[]` (outbound), typed relations:
  `cites · supports · constrains · supersedes · derivedFrom · invalidates · implements · verifies · observed-by · decided-by · applies-to`.
- **Derived views (layer-side, rebuildable):** the **backlink index** (`whoCites(B)`)
  and the **transitive impact set** (`impactOf(B)`). Derived inference labels:
  `affected-by · requires-review · citation-stale · decision-at-risk · evidence-missing`.
- **Lifecycle operations become observations → twin:**
  - **Update** B's content → `SourceChanged(B)` → every citer flagged; freshness
    posterior of citers drops; "N nodes cite content that just changed — re-review."
  - **Move** B → backlink index gives the *exact* rewrite set — a rename-refactor
    with a precise blast radius (`ReferenceRetargeted`).
  - **Drop** B → `ReferenceBroken` per citer → twin surfaces dangling citations +
    impact; the operator chooses redirect / supersede / accept.
- **Quality bar:** *nothing silently goes stale.* Not "nothing ever ages" — "nothing
  ages unnoticed."

---

## 5. pack-skin — the specialization model

`knowledge` (base layer) ships *mechanism*; a **pack-skin** declares the domain's
*choices*. This is the studio thesis — sell the builder, not the paths — applied to
documents.

A pack-skin declares (declaratively, D6):

- **kinds** — the document kinds and their `metadata` shape (and the `kindRef` catalog
  knowledge nodes resolve against);
- **lifecycle** — the allowed states and transitions;
- **wordings** — terminology, layered through `pickLocaleBundle` (composes with i18n,
  does not replace it — a skin can be themed *and* translated);
- **citation rules** — which relations are valid, what may be a target (doc-only vs
  code-symbols vs other nodes), authored vs extracted capture;
- **content-adapter** — which `ContentPort` adapter this corpus uses.

The base layer supports *both* authored and extracted citation capture as mechanisms;
the skin configures which (so "authored vs extracted" is a skin decision, not a fork
in the layer).

**Strict separation from theme-skin:** a pack-skin never touches the palette; a
theme-skin never touches wording or behaviour.

---

## 6. The three tiers (build order, D9)

Each tier consumes the prior tier's structure and adds *exactly one* kernel concern —
no tier forces a rebuild of the one below it. That is the test that this is genuinely
*one* substrate model, not three bolted-together features.

- **S1 — Document management (retrieval + references).** Concern #1 +
  `metadata.contentRef` + the pgvector index + citation capture + `whoCites`
  backlinks. *"Find the exact doc/context; tell me where it's cited."* Shippable on
  substrate as it stands.
- **S2 — The twin (assessment).** Adds concern #2 (the observation log:
  `SourceChanged` / `Contradicts` / `ReferenceBroken` / `QueriedByAgent`) and concern
  #3 (inference → freshness / relevance / confidence / **impact** posteriors). The S1
  tree is untouched. The two load-bearing outputs:
  1. **minimal valid context packs** — given a target node, return ancestry +
     dependencies + dependents + evidence + validity within a token budget;
  2. **nothing silently goes stale** — source change → flag citers → queue review.

  This is where the AI-cost economics land: broad search is replaced by *governed
  context navigation* (smaller context, higher validity). **All three (context-pack
  derivation, stale propagation, embedding refresh) run async / off the synchronous
  request path** — a request handler is never coupled to this compute (preserves the
  reproducibility boundary, ADR-176).
- **S3 — Provenance.** Adds concern #4 (run manifests, "what we knew at T") + why a
  node *and its citations* exist.

---

## 7. Origin: foundry as first consumer; the document core is built new (Approach #1, revised)

Codebase investigation (writing-plans S0) corrected the original "extract foundry's
artifact core" story: **foundry has no document/citation store to extract.** Its
persistence is an append-only event log + *derived* blueprints; "references" are
unindexed `metadata.crossRefs`; "versions" are generation-run content hashes.

- **Build the document core new** (`contentRef`/`cites[]`/`whoCites`/pgvector did not
  exist in foundry).
- **Move only the one reusable, substrate-free primitive** — a content-hash util
  (`canonicalJson`+`sha256Hex`) for contentRef integrity (S1) + provenance pinning
  (S3). Foundry's blueprint/compiler core is cataloged for the §8 follow-on, not moved
  as dead code (YAGNI/ADR-176).
- **Foundry becomes the first consumer** — its artifact cascade is the first
  **pack-skin**, the *architecture-knowledge skin*:

  ```text
  Design Note (DN)
    are bounded/justified by  Technical ADR (T-ADR)
      are bounded by          Solution ADR (S-ADR)
        are bounded by        Enterprise ADR (E-ADR)
          are derived from    Standard / Principle / Reference Architecture / Strategy
  ```

  with the relation vocabulary of §4. (Authority/role/gate semantics — who may author
  vs ratify each artifact — are *skin* concerns, not base-layer concerns.)
- **Precedent:** this is the same self-application shape as the foundry-as-substrate
  design (extract a proven need into a reusable model), and the same ingestion shape
  as markets-from-CoinGecko (git docs are an external source feeding the twin).

A scaffold precondition (for the plan, not this spec): confirm exactly what foundry
already stores re: artifacts/references/versions before extracting, so the extraction
is a *move*, not a re-invention.

---

## 8. Blueprints as a knowledge pack-skin (the charter-runtime seam)

Blueprints are a second pillar of the infrastructure, and they ride this same spine —
a blueprint is a plan tree + a typed shape on `metadata`, structurally identical to a
knowledge node. They have **two faces**, and only one is "the same as documents":

- **Definition (artifact) → a `knowledge` pack-skin.** A blueprint's *definition* is a
  versioned, cross-referenced document. It wants exactly what `knowledge` provides:
  versioning, references (`derivedFrom` a standard, `implements` a principle),
  retrieval, and impact analysis. So a blueprint is a `blueprint` pack-skin of the
  knowledge layer, managed identically to ADRs/specs. (This is what foundry already
  does: extract / version / reference blueprints.)
- **Execution (runtime) → `charter-runtime`, not a document skin.** Instantiate → run
  → measure-deviation → improve is *runtime* behaviour, and it already has a ratified
  home: the recursive charter-runtime arc (CharterNode = PlanNode + contract on
  `metadata`, ADR-283, explicitly generalizing "foundry runtime + blueprint"). D6
  forbids shipped code in a skin, and instantiation is real plan-tree runtime — so it
  belongs to `charter-runtime`, not a `knowledge` skin.

**The join: `instantiates` is a reference-graph edge.** A project's plan tree
`instantiates` a blueprint. That single edge means the knowledge layer's existing
machinery (§4) hands you, for free:

- **backlinks** — "which projects instantiate blueprint B?";
- **impact** — "supersede/change B → which live instances now drift?" (the same
  stale-propagation rails as document citations);
- **deviation** — the diff between an instance and its blueprint reference, which is
  exactly the signal the deviation → observation → inference learning loop consumes
  ("abweichende Pläne erzeugen abweichende Beobachtungen").

Net: blueprint *definition* in `knowledge` (a pack-skin); blueprint *execution* in
`charter-runtime`; the two stitched by the `instantiates` reference edge — so the
learning loop rides the knowledge layer's reference + impact rails with no new kernel
surface.

---

## 9. Why the kernel stays untouched (ADR-176)

Inclusion test, both parts must hold to enter the kernel:

- (a) one of the four concerns? **No** — document management is a *composition* of
  them. Fails (a).
- (b) needed by ≥2 packs as shared infra the kernel must validate/query/version? Even
  if ≥2 packs need *documents*, the kernel does not need to *understand* documents —
  it lends the primitives. Fails (b) at the kernel level.

→ **Layer territory.** The reference relation starts in the layer (`metadata.cites[]` — a layer-side derived edge index); it graduates to a typed kernel `PlanNodeId`
relation **only** on demonstrated ≥2-pack need (demand-driven promotion). Likewise,
efficiently querying `metadata.cites[]` would eventually want a JSONB-path GIN index
on `kernel.plan_node` — itself a kernel migration; keep the index **layer-side** and
treat any kernel-index promotion as demand-driven (ADR-176 §3), never speculative.

---

## 10. Patent-sensitive runtime (handle internally)

Per the founder's patent assessment, the *model* is hard to patent (abstract) but two
**runtime mechanisms** are the strongest invention-disclosure candidates. Treat as
internal; do not publicly disclose detail before a Swiss patent attorney reviews:

1. **Context-navigation runtime** — deriving minimal *valid* AI context packs from
   plan tree + reference graph + validity state within a budget.
2. **Stale-artifact propagation** — detecting and propagating staleness through
   artifact/plan dependencies and computing the review-required set on change.

(The reproducible-inference runtime, pack-safe projection, and blueprint
instantiation/deviation tracking are sibling candidates owned elsewhere.)

---

## 11. Non-goals (YAGNI)

- **Not** an Organizational OS, ERP, or Confluence replacement — those are downstream
  vision facets, explicitly out of scope.
- **Not** a new kernel concept, table, column, or relation (D1, §9). In particular,
  **not** a reuse of `plan_node.importRef` (D4).
- **Not** a graph database or any second datastore (D2).
- **Not** theme/visual concerns (D5).
- **Not** blueprint *execution* runtime — that is `charter-runtime` (D10, §8).
- **Not** authority/workflow/gate semantics in the base layer — those are skin
  concerns (or a separate SDLC pack-skin).

---

## 12. Open questions

- **OQ1 — Sub-document granularity.** v1 node = a *document* as the primary unit, with
  optional child nodes for sections when a skin needs sub-document retrieval/citation.
  Confirm whether the architecture-knowledge skin needs section-level nodes on day one.
- **OQ2 — Relationship to the existing SDLC knowledge-graph** (`devloop-knowledge-graph`
  MCP, Strain/KEP read-side). Is that subsumed into `knowledge` over time, kept as a
  sibling source, or left as the SDLC-delivery twin (a different system)? Leaning:
  sibling source first; revisit on demand.
- **OQ3 — Embedding/model choice for pgvector** (which embedding model, dimensionality,
  refresh cadence) — defer to the plan; not load-bearing for the design.
- **OQ4 — Extraction surface from foundry** — the exact module boundary to lift (needs
  the codebase confirmation noted in §7).

---

## 13. Next step

On founder approval of this spec, produce the implementation plan
(superpowers:writing-plans): phase the extraction from foundry (S0), then S1
(document management + references), S2 (the twin: context navigation + stale
propagation), S3 (provenance) — each PR-gated per the cluster workflow, verifier wave
on non-trivial slices.
