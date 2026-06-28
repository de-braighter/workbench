# Knowledge Layer — S3 (Provenance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every twin output **reproducible and explainable** — pin each context-pack derivation and twin readout under a **run manifest** ("what we knew at T": the event-log sequence bound + the corpus/embedding/catalog versions + the seed), and surface **why a node and its citations exist**. Adds kernel concern #4 (reproducibility) on top of S2 with no rebuild of S1/S2. Zero kernel change. The base-layer build ends here; the **blueprint pack-skin + charter-runtime `instantiates` seam (spec §8)** is documented as a follow-on, not built.

**Architecture:** S3 reuses the published reproducibility surface — `RUN_MANIFEST_REPOSITORY` (`RunManifestRepository.save/find`, RLS-scoped) + the `RunManifest` tuple + the `kernel:InferenceRunCompleted.v1` event — to pin the S2 derivations. A context pack / twin readout becomes a *run*: its inputs (target id, corpus snapshot hash, embedding model+dim, `catalogVersionHash`, seed) + the immutable `eventLogThroughSeq` bound are recorded so the exact pack can be reconstructed "as of T." A `ProvenanceService` answers "what we knew at T" (resolve a pinned run) and "why does this node + its citations exist" (the node's content-hash lineage + its `cites[]` provenance + the runs that consumed it). Reproducibility stays an **async/offline** concern (a request reads pinned results; it never recomputes a posterior on the request path — the ADR-176 boundary, carried from S2).

**Tech Stack:** TypeScript (ESM/NodeNext), Zod, Vitest; `@de-braighter/substrate-contracts` (`/reproducibility`: `RunManifestRepository`, `RunManifest`, `RunManifestRecord`, `INFERENCE_RUN_COMPLETED_EVENT_TYPE`, `DistributionCatalog`); `@de-braighter/substrate-runtime` (`PrismaRunManifestRepository`, `GucPrismaRunner`, the `InMemoryRunManifestRepository` test double); the substrate DB-test harness.

**Spec:** `docs/superpowers/specs/2026-06-28-knowledge-pack-design.md` — §6 S3 (provenance: run manifests, "what we knew at T" + why a node and its citations exist), §8 (blueprints as a knowledge pack-skin + the charter-runtime `instantiates` seam — the follow-on), §10 (the reproducible-inference runtime is a *sibling* patent candidate owned elsewhere — the substrate's reproducibility surface; the knowledge layer composes it), D9 build order.

**Cross-repo note:** Tasks 1–3 are in `layers/knowledge/` (own branch `feat/s3-provenance`). Task 4 is the follow-on **design note only** (no code) — recorded in this plan + optionally a short doc; the blueprint pack-skin and the `instantiates` seam get their own spec + plan after S3 merges.

---

## Global Constraints

- **ESM/NodeNext**, `"type": "module"`, explicit `.js`.
- **ZERO kernel change (STOP/escalate)** — same byte-identical substrate list as S0–S2. Run manifests ride the published `RUN_MANIFEST_REPOSITORY` + the `kernel:InferenceRunCompleted.v1` event; the knowledge layer adds no kernel reproducibility column or table. **Any need to extend the kernel `RunManifest` tuple or `run_manifest` table is a STOP — escalate.** (The reproducible-inference runtime is substrate-owned, spec §10; the layer composes it.)
- **Pin, don't recompute** — a provenance read resolves a *stored* `RunManifestRecord` (`find`); it never re-runs inference on the request path (the S2 async boundary, ADR-176). Re-derivation for verification is an offline/worker concern.
- **Replay-stable** — the pinned inputs (corpus snapshot hash via `hashContextPack`, embedding model+dim, `catalogVersionHash`, `seed`, `eventLogThroughSeq`) fully determine a re-derivation; no wall-clock/random in the derivation path (carried from S2). `RunManifestRecord.id = manifest.requestId` is forward-only (re-save of the same id → `conflict`).
- **RLS via `GucPrismaRunner.run(tenantPackId, fn)`**; `RunManifestRepository.save/find` are tenant-scoped — never cross-tenant.
- **Derived stays derived (D3)** — provenance answers are derived views over the run-manifest index + the corpus + the event log; the only persisted S3 state is the kernel-owned run-manifest index (via the published repository) and the `InferenceRunCompleted` events.
- **Branch discipline** — feature branch in `layers/knowledge`; never `git add -A`; never git ops in shared clones.

---

## File Structure

```text
layers/knowledge/libs/knowledge-contracts/src/
├── provenance.ts            ContextPackRunInputs + the pin/lineage value types (Task 1)
├── provenance.spec.ts
└── index.ts

layers/knowledge/libs/knowledge-runtime/src/
├── run-pin.service.ts       pins a context-pack/readout run via RUN_MANIFEST_REPOSITORY (Task 1)
├── run-pin.service.spec.ts
├── provenance.service.ts    "what we knew at T" + "why does this node exist" (Task 2)
├── provenance.service.spec.ts
├── provenance.db.spec.ts    real-DB pin → find round-trip + RLS proof (Task 3)
└── index.ts
```

---

### Task 1: Pin a derivation under a run manifest (TDD)

**Files:**

- Create: `libs/knowledge-contracts/src/provenance.ts` (+ spec); modify barrel.
- Create: `libs/knowledge-runtime/src/run-pin.service.ts` (+ spec).

**Interfaces:**

- Consumes: `RunManifest`, `RunManifestRecord`, `RunManifestRepository`, `RUN_MANIFEST_REPOSITORY`, `INFERENCE_RUN_COMPLETED_EVENT_TYPE` from `@de-braighter/substrate-contracts/reproducibility`; `DOMAIN_EVENT_PUBLISHER` (`/events`); `hashContextPack` (`./content-hash.js`); `ContextPack` (S2).
- Produces (contracts, PURE):
  - `interface ContextPackRunInputs { targetId: string; corpusHash: string; embeddingModel: string; embeddingDim: number; catalogVersionHash: string; seed: string; eventLogThroughSeq: string }`
  - `contextPackInputHash(inputs: ContextPackRunInputs): string` — `sha256(canonicalJson(inputs))`, the replay-pin `inputHash` (deterministic; powers `RunManifest.inputHash`).
- Produces (runtime):
  - `RunPinService.pinContextPack({ tenantPackId, requestId, pack, inputs })` — assembles a `RunManifestRecord` (`id = requestId`, `method = 'posterior'` or a knowledge-specific method label, `manifest` carrying `inputHash = contextPackInputHash(inputs)` + `catalogVersionHash` + `seed` + `observationsHash`, `eventLogThroughSeq = inputs.eventLogThroughSeq`), `save`s it via `RUN_MANIFEST_REPOSITORY`, and (optionally) emits `kernel:InferenceRunCompleted.v1` via `DOMAIN_EVENT_PUBLISHER`. Returns the pinned `id`. **Async/offline** — invoked by the S2 context-pack/readout workers after they derive, never on a request path.

- [ ] **Step 1: PRECONDITION — read the installed reproducibility surface.** Read the installed `@de-braighter/substrate-contracts/reproducibility` `.d.ts` for the exact `RunManifest` + `RunManifestRecord` field names + `RunManifestRepository.save/find` signatures (the report: `save(tenantPackId, record): Promise<Result<void, …>>`, record has `id`/`tenantPackId`/`method`/`manifest`/`treeRootId`/`subjectRef`/`indicatorKey`/`asOfIso`/`eventLogThroughSeq`/`posteriorSummary`/`createdAtIso`). Match the exact shape; do not invent fields. Note `method: RunMethod = 'posterior' | 'sample' | 'counterfactual'` is a closed set — a context pack pins under the closest method (`'posterior'`) with the knowledge specifics in `manifest`/inputs (do NOT widen `RunMethod` — that is a kernel change → STOP).

- [ ] **Step 2: Write the failing `contextPackInputHash` test** — deterministic, order-independent over object keys (reuses `canonicalJson` semantics), changes when any input changes. Run → fail → write `provenance.ts` → pass.

- [ ] **Step 3: Write the `RunPinService` test** with `InMemoryRunManifestRepository` (test double): `pinContextPack` saves a record whose `id` = `requestId`, `manifest.inputHash` = `contextPackInputHash(inputs)`, and `eventLogThroughSeq` = the bound; a re-pin of the same `requestId` returns the repository's `conflict` (forward-only) and does not overwrite. Run → fail → write `run-pin.service.ts` → pass.

- [ ] **Step 4: Gate + commit.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-contracts/src/provenance.ts libs/knowledge-contracts/src/provenance.spec.ts libs/knowledge-runtime/src/run-pin.service.ts libs/knowledge-runtime/src/run-pin.service.spec.ts libs/knowledge-contracts/src/index.ts
git commit -m "feat(knowledge): pin context-pack/readout derivations under a run manifest (what we knew at T)"
```

---

### Task 2: Provenance reads — "what we knew at T" + "why this node exists" (TDD)

**Files:**

- Create: `libs/knowledge-runtime/src/provenance.service.ts` (+ spec)

**Interfaces:**

- Produces:
  - `ProvenanceService.whatWeKnewAt(runId): Promise<{ inputs: ContextPackRunInputs; manifest: RunManifest } | null>` — resolves a pinned run via `RUN_MANIFEST_REPOSITORY.find(tenantPackId, runId)` (exhaustive-switch on the `Result`; `not-found`/RLS-hidden → null). Read-only; never recomputes.
  - `ProvenanceService.whyNodeExists(nodeId): Promise<{ node: { contentRef; contentHash }; cites: { edge: CiteEdge; targetSummary?: string }[]; consumedByRuns: string[] }>` — the node's content-hash lineage (S1 `contentRef` + the latest `SourceChanged` hashes from the event log), its outbound `cites[]` provenance (each edge + the cited target's summary), and the run ids that consumed this node in a context pack (looked up over the pinned runs whose pack `included` the node). Derived; no recompute.

- [ ] **Step 1: Write the failing test** with `InMemoryRunManifestRepository` (seeded pins) + a fake corpus/event source: `whatWeKnewAt(knownId)` returns the pinned inputs+manifest; `whatWeKnewAt('absent')` and a cross-tenant id return null (RLS); `whyNodeExists(B)` returns B's contentRef + hash, its `cites[]` with target summaries, and the ids of runs whose pack included B.

- [ ] **Step 2: Run → fail. Write `provenance.service.ts`.** Run → pass.

- [ ] **Step 3: Gate + commit.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-runtime/src/provenance.service.ts libs/knowledge-runtime/src/provenance.service.spec.ts libs/knowledge-runtime/src/index.ts
git commit -m "feat(knowledge): provenance reads — resolve a pinned run + explain why a node and its citations exist"
```

---

### Task 3: Real-DB pin → find round-trip + RLS proof (DB)

**Files:**

- Create: `libs/knowledge-runtime/src/provenance.db.spec.ts`

- [ ] **Step 1: Write the failing DB test** (`describe.skipIf(!DATABASE_URL)`, mirroring `prisma-run-manifest-repository.rls.integration.spec.ts`): construct `PrismaRunManifestRepository` over the real client; under tenant T1, `pinContextPack` then `whatWeKnewAt(id)` returns the record; the same `find` under tenant T2 returns `not-found` (RLS proof); a re-pin of the same `id` returns `conflict`. Run via the db tier:

```bash
cd D:/development/projects/de-braighter/layers/knowledge
npx vitest run -c libs/knowledge-runtime/vitest.db.config.ts libs/knowledge-runtime/src/provenance.db.spec.ts
```

Expected: PASS (not skipped). The cross-tenant `not-found` is non-negotiable.

- [ ] **Step 2: Verify the Kernel-Untouched Invariant (zero-diff guard).** From the substrate clone, confirm S3 added nothing to the kernel:

```bash
cd D:/development/projects/de-braighter/layers/substrate
git diff --stat origin/main -- libs/substrate-contracts/src libs/substrate-runtime/src/plan-tree libs/substrate-runtime/src/reproducibility prisma sql
```

Expected: **empty output**. (S3 consumes the published reproducibility surface; it edits no substrate file.) If anything shows, revert it — STOP/escalate.

- [ ] **Step 3: Gate + commit + push.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-runtime/src/provenance.db.spec.ts
git commit -m "test(knowledge): real-DB run-manifest pin→find round-trip + cross-tenant RLS proof"
git push -u origin feat/s3-provenance
```

---

### Task 4: Follow-on design note — blueprint pack-skin + the charter-runtime `instantiates` seam (spec §8) — NO CODE

**Files:** none in code. Record the follow-on here (and optionally a short `docs/superpowers/specs/` stub on founder request). **This task does NOT implement anything — it scopes the next spec+plan.**

- [ ] **Step 1: Record the follow-on scope.** The blueprint pillar is a *separate* spec + plan after S3 merges, not part of the base layer. It has two faces (spec §8), and only one is "the same as documents":
  - **Blueprint *definition* → a `knowledge` pack-skin (the document face).** A blueprint's definition is a versioned, cross-referenced document; it wants exactly what S1 provides (versioning, references `derivedFrom`/`implements`, retrieval, impact). This is where the **S0-catalogued foundry extraction completes**: move `domains/foundry/src/metamodel/{blueprint,generate,vocabulary,substance-log}.ts` + `plan/cascade.ts` + `compiler/*` into a new layer lib (e.g. `libs/knowledge-blueprint`) as the `blueprint` pack-skin's engine, and flip foundry to consume it. (S0 deliberately deferred this to avoid moving dead code; the blueprint pack-skin is the consumer that makes the move live.)
  - **Blueprint *execution* → `charter-runtime`, NOT a knowledge skin.** Instantiate → run → measure-deviation → improve is runtime behaviour with a ratified home (`@de-braighter/charter-runtime`, ADR-283 — CharterNode = PlanNode + contract on `metadata`). D6 forbids shipped code in a skin, so instantiation stays in charter-runtime.
  - **The join: `instantiates` is a reference-graph edge.** A project's plan tree `instantiates` a blueprint. This requires a small **additive contract bump**: add `'instantiates'` to `CITE_RELATIONS` (S1 Task 2) — flag it as the one contract change the follow-on needs (additive, non-breaking). With that edge, the S1/S2 machinery hands the learning loop, for free:
    - backlinks — "which projects instantiate blueprint B?" (`whoCites(corpus, B)` filtered to `instantiates`);
    - impact — "supersede/change B → which live instances now drift?" (the S2 stale-propagation rails);
    - deviation — the diff between an instance and its blueprint reference (the signal the charter-runtime deviation→observation→inference loop consumes).
  - **Net:** blueprint *definition* in `knowledge` (a pack-skin) + blueprint *execution* in `charter-runtime`, stitched by the `instantiates` edge — no new kernel surface.

- [ ] **Step 2: File the follow-on as a tracked item** (a GitHub story-tracker issue per the cluster workflow, or a foundry queue item): "knowledge × charter-runtime: blueprint pack-skin (definition) + `instantiates` seam — own spec+plan; completes the S0-catalogued foundry blueprint/compiler extraction; additive `instantiates` relation." Do NOT start it under this plan.

---

### Task 5: PR + verifier wave

- [ ] **Step 1: Open `de-braighter/knowledge#<n>`** (branch `feat/s3-provenance`). PR body lists the S3 deliverables + the follow-on note + the twin-ritual lines:

```text
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert; findings <one per 200 LoC>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 2: Verifier wave** (non-trivial: reproducibility pinning + a DB integration) → full wave in parallel, `isolation: "worktree"`: `local-ci` + `reviewer` + `charter-checker` + `qa-engineer`. `charter-checker` certifies: run manifests ride the published repository (no kernel reproducibility change — the zero-diff guard from Task 3), `RunMethod` not widened, derived-not-stored holds, provenance reads never recompute on the request path. Post findings before merge; then `npm run ritual:post-merge`. **This PR closes the knowledge base-layer build (S0–S3).**

---

## Self-Review

**Spec coverage (S3):** §6 S3 concern #4 (run manifests, "what we knew at T") → Tasks 1/2/3. §6 S3 "why a node and its citations exist" → Task 2 (`whyNodeExists`). §8 blueprint pack-skin + `instantiates` seam (follow-on, not built) → Task 4 (recorded + filed, incl. the additive `instantiates` relation and the completion of the S0-catalogued foundry extraction). §10 reproducible-inference runtime = substrate-owned sibling candidate → the layer composes `RUN_MANIFEST_REPOSITORY`, adds no kernel reproducibility surface (Global Constraints + Task 3 zero-diff guard). D9 build order (S3 consumes S1/S2, no rebuild) → by construction.

**Placeholder scan:** no TBD/TODO; the pure pin/hash code is complete; the repository-shape task specifies the confirm-at-execution precondition (read the installed `/reproducibility` `.d.ts`) the house style uses for substrate-contract consumption; Task 4 is intentionally code-free (it scopes the follow-on, with the one additive contract change it will need named).

**Type consistency:** `ContextPackRunInputs`/`contextPackInputHash` (Task 1) consumed by `RunPinService` (Task 1) + `ProvenanceService` (Task 2); `RunManifestRecord`/`RunManifestRepository`/`RUN_MANIFEST_REPOSITORY` (substrate) used consistently across Tasks 1/2/3; `ContextPack`/`hashContextPack` (S2/S0) reused for the corpus/input hashing; `CiteEdge` (S1) used in `whyNodeExists`.

## Risks / open questions

- **`RunMethod` is a closed set** (`posterior|sample|counterfactual`) — a context-pack pin reuses `'posterior'` with the knowledge specifics in `manifest`/inputs; widening `RunMethod` would be a kernel change (STOP). Confirm the chosen mapping reads cleanly in the provenance UI at execution.
- **The `instantiates` relation** is the one additive contract bump the §8 follow-on needs (S1 `CITE_RELATIONS`); it is non-breaking but should land with the blueprint-pack-skin spec, not retro-fitted ad hoc.
- **The S0-catalogued foundry blueprint/compiler extraction** completes only in the §8 follow-on (Task 4) — until then the layer's blueprint pillar is documented, not coded; the base layer (S0–S3) is the document/twin/provenance core, which is the shippable deliverable.
