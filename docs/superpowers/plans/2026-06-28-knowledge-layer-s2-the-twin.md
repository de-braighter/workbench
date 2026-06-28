# Knowledge Layer — S2 (The Twin: Assessment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the S1 corpus into a *twin*: append-only **observations** (`knowledge:SourceChanged.v1` / `Contradicts.v1` / `ReferenceBroken.v1` / `ReferenceRetargeted.v1` / `QueriedByAgent.v1`) on the kernel event log, **inference posteriors** (freshness / relevance / confidence / impact) via the published backbone, and the two load-bearing outputs — **minimal valid context packs** and **"nothing silently goes stale."** All heavy compute (context-pack derivation, stale propagation, embedding refresh) runs **async / off the synchronous request path**. The S1 tree is untouched. Zero kernel change.

**Architecture:** S2 adds kernel concern #2 (flatten the observation) and concern #3 (inference) without rebuilding S1. Observations are emitted through the published `DOMAIN_EVENT_PUBLISHER.publishAll(events, tx)` (→ `kernel.event_log` via the outbox) inside the same transaction as the S1 corpus mutation that caused them. Posteriors come from the published `INFERENCE_BACKBONE.posterior()` over `ObservationProjection`s (event-log JsonPath arm) registered for four knowledge indicators. The two outputs are **async workers**: a `ContextPackService` (derive ancestry + deps + dependents + evidence + validity within a token budget; content-addressed + cached) and a `StalePropagationService` (on a source change, walk `impactOf` over the S1 backlink index, flag citers, queue review). An `EmbeddingRefreshWorker` keeps the S1 pgvector index current. A request handler is **never** coupled to any of these (preserves the reproducibility boundary, ADR-176 / spec §6).

**Tech Stack:** TypeScript (ESM/NodeNext), Zod, Vitest; `@de-braighter/substrate-contracts` (`/events`, `/inference`, `/plan-tree`); `@de-braighter/substrate-runtime` (`DOMAIN_EVENT_PUBLISHER` → `PrismaOutboxWriter`, `INFERENCE_BACKBONE` → `InferenceBackboneRouter`, `GucPrismaRunner`, the InferenceCatalog registration surface); a job queue for the async workers (BullMQ/pg-boss or an interim in-process queue — chosen in Task 5 Step 1); the substrate DB-test harness + the `InMemoryInferenceBackbone`/`InMemoryDomainEventPublisher` test doubles from `@de-braighter/substrate-*/testing`.

**Spec:** `docs/superpowers/specs/2026-06-28-knowledge-pack-design.md` — §4 (lifecycle ops → observations → twin; derived labels), §6 S2 (the two outputs; **all three computes async**), §10 (the two patent-sensitive runtimes — context-navigation + stale propagation — handle internally), OQ3 (embedding model/cadence). Build order D9: S2 consumes S1 structure and adds exactly two concerns, no rebuild of S1.

**Cross-repo note:** All work is in `layers/knowledge/` (own branch `feat/s2-twin`). No substrate or foundry edits.

---

## Global Constraints

- **ESM/NodeNext**, `"type": "module"`, explicit `.js`.
- **ZERO kernel change (STOP/escalate)** — same byte-identical substrate list as S0/S1. Observations ride the published `DOMAIN_EVENT_PUBLISHER` (the kernel validates only the *envelope*; `payload` is opaque knowledge JSON we own). Posteriors ride the published `INFERENCE_BACKBONE` + the `ObservationProjection` registry slot (pure data — JsonPaths over `kernel.event_log` JSONB; the kernel never learns knowledge semantics, R2). **Any need for a new kernel event column, projector, or inference family is a STOP — escalate.**
- **ALL heavy compute is ASYNC / off the request path (HARD, spec §6).** Context-pack derivation, stale propagation, and embedding refresh run in workers, never in an HTTP handler. A synchronous handler may *enqueue* and *read a cached result*, never *compute*. A reviewer/qa finding that any of the three runs in a request path is **blocking**. (This is the reproducibility-boundary guarantee, ADR-176.)
- **Event types are versioned `.vN` from day one** (`knowledge:SourceChanged.v1`, …) and pack-namespaced (`packId: 'knowledge'`). Additive bumps only.
- **Replay-stable** — no `Date.now()`/`Math.random()` in any fold, projection, or context-pack derivation; `occurredAt`, ids, and seeds are injected by the caller/worker (so S3 can pin a run).
- **RLS via `GucPrismaRunner.run(tenantPackId, fn)`** — the modern entry (ScopedPrismaService deprecated, ADR-197). Every event append + every layer-table read/write runs inside it; never hand-write a `tenant_pack_id` WHERE clause.
- **Derived stays derived (D3)** — posteriors, labels, context packs, and the impact closure are derived views; the only persisted S2 state is the event log (kernel-owned) + the rebuildable pgvector cache (S1) + a job/queue table (operational, rebuildable).
- **Patent-sensitive (spec §10)** — the context-navigation runtime (Task 5) and the stale-propagation runtime (Task 6) are the strongest invention-disclosure candidates. Keep design detail internal; do not write external-facing docs/marketing about the mechanism. Flag both in the PR body as patent-sensitive.
- **Branch discipline** — feature branch in `layers/knowledge`; never `git add -A`; never git ops in shared clones.

---

## File Structure

```text
layers/knowledge/libs/knowledge-contracts/src/
├── observations.ts          knowledge event types + payload zod + envelope builders (Task 1)
├── observations.spec.ts
├── indicators.ts            the 4 indicator keys + ObservationProjection specs (Task 3)
├── indicators.spec.ts
├── labels.ts                derived twin labels from posteriors + impact (Task 4)
├── labels.spec.ts
├── context-pack.ts          ContextPack type + pure budget-bounded selection (Task 5)
├── context-pack.spec.ts
└── index.ts

layers/knowledge/libs/knowledge-runtime/src/
├── observation-emitter.service.ts     emits events on lifecycle ops (Task 2)
├── twin-readout.service.ts            posteriors + labels via INFERENCE_BACKBONE (Task 4)
├── workers/context-pack.worker.ts     ASYNC context-pack derivation (Task 5)
├── workers/stale-propagation.worker.ts ASYNC stale propagation (Task 6)
├── workers/embedding-refresh.worker.ts ASYNC embedding refresh (Task 7)
├── queue.port.ts                      JobQueue port + adapter selection (Task 5)
└── index.ts
```

---

### Task 1: Knowledge observation events (TDD)

**Files:**

- Create: `libs/knowledge-contracts/src/observations.ts`, `observations.spec.ts`; modify barrel.

**Interfaces:**

- Consumes: `DomainEventEnvelopeSchema` (type) from `@de-braighter/substrate-contracts/events`; `CiteEdge` (`./cites.js`).
- Produces (each a payload Zod + a builder returning a `DomainEventEnvelope`-shaped object — `eventType` versioned + namespaced, `packId: 'knowledge'`, `aggregateType: 'KnowledgeNode'`, `aggregateId: <nodeId>`):
  - `knowledge:SourceChanged.v1` — `{ nodeId, contentHashBefore, contentHashAfter }`
  - `knowledge:Contradicts.v1` — `{ nodeId, otherNodeId, detail }`
  - `knowledge:ReferenceBroken.v1` — `{ citerId, brokenTarget, relation }`
  - `knowledge:ReferenceRetargeted.v1` — `{ citerId, oldTarget, newTarget, relation }`
  - `knowledge:QueriedByAgent.v1` — `{ nodeId, queryId, rank }`
  - `KNOWLEDGE_EVENT_TYPES` (the closed set) + `makeKnowledgeEvent(...)` factory taking `{ tenantPackId, occurredAt, actorRef, ... }` (caller injects `occurredAt` + ids — replay-stable).

- [ ] **Step 1: Write the failing test** — each builder produces an envelope that passes `DomainEventEnvelopeSchema.parse`, with the right `eventType`/`packId`/`aggregateId`, and each payload fails closed on a missing field.

```typescript
import { DomainEventEnvelopeSchema } from '@de-braighter/substrate-contracts/events';
import { sourceChanged, referenceBroken, KNOWLEDGE_EVENT_TYPES } from './observations.js';

const base = { tenantPackId: '55555555-5555-4555-8555-555555555555', occurredAt: '2026-06-28T00:00:00.000Z', actorRef: 'system' };

describe('knowledge observation events', () => {
  it('sourceChanged builds a valid versioned envelope', () => {
    const e = sourceChanged({ ...base, nodeId: '111...uuid', contentHashBefore: 'a', contentHashAfter: 'b' });
    expect(() => DomainEventEnvelopeSchema.parse(e)).not.toThrow();
    expect(e.eventType).toBe('knowledge:SourceChanged.v1');
    expect(e.packId).toBe('knowledge');
    expect(e.aggregateId).toBe('111...uuid');
  });
  it('referenceBroken carries the citer + broken target', () => {
    const e = referenceBroken({ ...base, citerId: '222...uuid', brokenTarget: 'B', relation: 'derivedFrom' });
    expect(e.payload).toMatchObject({ citerId: '222...uuid', brokenTarget: 'B', relation: 'derivedFrom' });
  });
  it('the event-type set is closed + all .v1', () => {
    for (const t of KNOWLEDGE_EVENT_TYPES) expect(t).toMatch(/^knowledge:[A-Za-z]+\.v1$/);
  });
});
```

- [ ] **Step 2: Run → fail. Write `observations.ts`** (payload schemas + builders; `makeKnowledgeEvent` sets `eventVersion: 1`, `packId: 'knowledge'`, `metadata: { actorRef }`, validates the payload before returning). Confirm the exact `DomainEventEnvelope` field names at execution against the installed `@de-braighter/substrate-contracts/events` `.d.ts` (the report: eventId?, tenantPackId, packId, aggregateType, aggregateId, eventType, eventVersion, payload, metadata, occurredAt).

- [ ] **Step 3: Run → pass. Export + commit.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-contracts/src/observations.ts libs/knowledge-contracts/src/observations.spec.ts libs/knowledge-contracts/src/index.ts
git commit -m "feat(knowledge-contracts): versioned observation events (SourceChanged/Contradicts/ReferenceBroken/Retargeted/QueriedByAgent)"
```

---

### Task 2: Emit observations on lifecycle ops (TDD)

**Files:**

- Create: `libs/knowledge-runtime/src/observation-emitter.service.ts` (+ spec)
- Modify: `corpus.service.ts` (S1) to call the emitter inside its mutation transaction.

**Interfaces:**

- Produces: `ObservationEmitterService` with `onContentChanged(tx, { nodeId, before, after, ... })`, `onMove(tx, { nodeId, retargets })`, `onDrop(tx, { droppedId, citers })`, `onQueried(tx, { nodeId, queryId, rank })` — each builds the right envelopes (using the S1 backlink index for the *exact* citer set on move/drop) and calls `DOMAIN_EVENT_PUBLISHER.publishAll(events, tx)`.

- [ ] **Step 1: Write the failing test** with the `InMemoryDomainEventPublisher` test double (from `@de-braighter/substrate-runtime/testing`): dropping node B that is cited by A and C emits exactly two `knowledge:ReferenceBroken.v1` events (one per citer, derived from `whoCites`), in array order; moving B emits `ReferenceRetargeted` for each citer; a content change emits one `SourceChanged` with both hashes.

- [ ] **Step 2: Run → fail. Write `ObservationEmitterService`** — inject `DOMAIN_EVENT_PUBLISHER` + the S1 `BacklinkIndexService`. On move/drop, `whoCites(corpus, target)` gives the precise rewrite/break set (spec §4: "the exact rewrite set — a rename-refactor with a precise blast radius"). All appends go through `publishAll(events, tx)` so they commit atomically with the corpus mutation. Wire `CorpusService.updateContent/moveNode/dropNode` (S1) to call the emitter within the same `GucPrismaRunner.run(tenantPackId, tx => ...)` transaction.

- [ ] **Step 3: Run → pass. Gate + commit.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-runtime/src/observation-emitter.service.ts libs/knowledge-runtime/src/observation-emitter.service.spec.ts libs/knowledge-runtime/src/corpus.service.ts
git commit -m "feat(knowledge-runtime): emit observations on lifecycle ops (atomic with the corpus mutation; exact citer set from whoCites)"
```

---

### Task 3: Indicator registration — ObservationProjections (TDD)

**Files:**

- Create: `libs/knowledge-contracts/src/indicators.ts` (+ spec); modify barrel.

**Interfaces:**

- Produces:
  - `KNOWLEDGE_INDICATORS = { freshness: 'knowledge.indicator.freshness', relevance: '…relevance', confidence: '…confidence', impact: '…impact' } as const`
  - `buildKnowledgeInferenceCatalog(): InferenceCatalog` — registers the four indicators, each with an `ObservationProjection` (event-log arm: a `JsonPath` over the `knowledge:*` events) + a `conjugateHint` (e.g. `freshness`/`relevance` = Beta-Binomial over "still-current vs stale" / "useful-when-retrieved" observations; `confidence` = Normal-Normal). The exact family per dimension is the executor's modeling choice within the backbone's Phase-1 conjugate families.

- [ ] **Step 1: PRECONDITION — read the installed registration surface.** Before writing, read the installed `@de-braighter/substrate-contracts/inference` `ObservationProjection` + `JsonPath` `.d.ts`, the runtime `inference-catalog.port.ts` (`InferenceCatalog` shape), and a real example (`exercir`'s `buildPackFootballInferenceCatalog` or `markets`' inference catalog) for a verbatim registration pattern. Match its exact shape; do not invent.

- [ ] **Step 2: Write the failing test** — `buildKnowledgeInferenceCatalog()` returns a catalog with the four indicator keys; each projection is the `event-log` arm with a non-empty `JsonPath`; each indicator carries a `conjugateHint`. (No DB; pure registry assertions, like the markets/exercir catalog tests.)

- [ ] **Step 3: Run → fail. Write `indicators.ts`.** Run → pass.

- [ ] **Step 4: Gate + commit.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-contracts/src/indicators.ts libs/knowledge-contracts/src/indicators.spec.ts libs/knowledge-contracts/src/index.ts
git commit -m "feat(knowledge-contracts): freshness/relevance/confidence/impact indicators + ObservationProjections (event-log arm)"
```

---

### Task 4: Twin readout — posteriors + derived labels (TDD)

**Files:**

- Create: `libs/knowledge-contracts/src/labels.ts` (+ spec)
- Create: `libs/knowledge-runtime/src/twin-readout.service.ts` (+ spec)

**Interfaces:**

- Produces (contracts, PURE):
  - `type TwinLabel = 'affected-by' | 'requires-review' | 'citation-stale' | 'decision-at-risk' | 'evidence-missing'`
  - `deriveLabels(input: { freshnessMean: number; relevanceMean: number; confidenceMean: number; impactSize: number; brokenCites: number }): TwinLabel[]` — pure thresholded mapping (e.g. low freshness + inbound citers → `citation-stale`; `brokenCites > 0` → `evidence-missing`; high impact + low confidence → `decision-at-risk`).
- Produces (runtime):
  - `TwinReadoutService.assess(nodeId): Promise<{ posteriors: {...}; labels: TwinLabel[] }>` — calls `INFERENCE_BACKBONE.posterior({ tenantPackId, treeRoot, subject, indicatorKey, asOf })` for each of the four indicators (exhaustive-switch on the `Result` error per the no-throw port), reads `impactOf` (S1) for `impactSize`, and runs `deriveLabels`. **Read-only / synchronous is allowed here** (it reads cached posteriors via the backbone; it does not *derive* a context pack or *propagate* staleness). If a posterior is `not-implemented-phase-1`, the label degrades to `evidence-missing` rather than throwing.

- [ ] **Step 1: Write the failing `labels.ts` test** — golden cases for each label from the threshold inputs (pure, no I/O). Run → fail → write `labels.ts` → pass.

- [ ] **Step 2: Write the `TwinReadoutService` test** with the `InMemoryInferenceBackbone` test double (seeded posteriors) + a fake backlink index: asserts the four `posterior(...)` calls carry the right indicator keys + `tenantPackId`, and that `deriveLabels` is applied. Cover the `not-implemented-phase-1` degradation path.

- [ ] **Step 3: Write `twin-readout.service.ts`.** Run → pass.

- [ ] **Step 4: Gate + commit.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-contracts/src/labels.ts libs/knowledge-contracts/src/labels.spec.ts libs/knowledge-runtime/src/twin-readout.service.ts libs/knowledge-runtime/src/twin-readout.service.spec.ts libs/knowledge-contracts/src/index.ts
git commit -m "feat(knowledge): twin readout — freshness/relevance/confidence/impact posteriors + derived labels"
```

---

### Task 5: Output #1 — minimal valid context packs (ASYNC) (TDD)

> **Patent-sensitive (spec §10): the context-navigation runtime.** Keep design internal.

**Files:**

- Create: `libs/knowledge-contracts/src/context-pack.ts` (+ spec) — the PURE budget-bounded selection
- Create: `libs/knowledge-runtime/src/queue.port.ts`, `libs/knowledge-runtime/src/workers/context-pack.worker.ts` (+ spec)

**Interfaces:**

- Produces (contracts, PURE + deterministic — replay-stable):
  - `interface ContextPackInput { targetId: string; corpus: readonly NodeWithCites[]; nodeCost: (id: string) => number; tokenBudget: number; ancestry: readonly string[]; validity: (id: string) => boolean }`
  - `interface ContextPack { targetId: string; included: string[]; droppedForBudget: string[]; totalCost: number; corpusHash: string }`
  - `deriveContextPack(input: ContextPackInput): ContextPack` — selects ancestry + dependencies (outbound `cites`) + dependents (`whoCites`) + evidence, **filtered to valid nodes**, greedily within `tokenBudget` (priority: ancestry → direct deps → dependents → evidence); `corpusHash = hashContextPack(...)` over the selected ids + corpus revision (for S3 pinning).
- Produces (runtime):
  - `JobQueue` port (`enqueue(job)`, `process(handler)`) + the chosen adapter (Task Step 1).
  - `ContextPackWorker` — consumes a `derive-context-pack` job, loads the corpus via `GucPrismaRunner`, calls `deriveContextPack`, writes the result to a content-addressed cache (rebuildable), and emits nothing to the request path. A synchronous API may only `enqueue` + read the cache.

- [ ] **Step 1: Choose the queue adapter.** Default: `pg-boss` (Postgres-backed, no new infra) for the layer's async jobs; interim fallback = an in-process queue behind the same `JobQueue` port (for tests + single-process dev). Record the choice; keep all worker logic behind the `JobQueue` port so the adapter is swappable.

- [ ] **Step 2: Write the failing `deriveContextPack` test** — given a small corpus + a target + a tight `tokenBudget`, the pack includes ancestry first, respects the budget (drops lowest-priority over budget into `droppedForBudget`), excludes invalid nodes, and is deterministic (same input → identical `included` + `corpusHash`). Add a NEGATIVE test: a node failing `validity` never appears.

- [ ] **Step 3: Run → fail. Write `context-pack.ts`** (pure greedy selection; `corpusHash` via `hashContextPack` from `@de-braighter/knowledge-contracts`). Run → pass.

- [ ] **Step 4: Write the `ContextPackWorker` test** (in-process queue double): enqueuing a job derives + caches the pack; a second identical enqueue is idempotent (same `corpusHash`); the worker never runs in a request path (assert by construction — the service exposes only `enqueue` + `readCached`, no synchronous `derive`).

- [ ] **Step 5: Gate + commit.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-contracts/src/context-pack.ts libs/knowledge-contracts/src/context-pack.spec.ts libs/knowledge-runtime/src/queue.port.ts libs/knowledge-runtime/src/workers/context-pack.worker.ts libs/knowledge-runtime/src/workers/context-pack.worker.spec.ts libs/knowledge-contracts/src/index.ts
git commit -m "feat(knowledge): minimal valid context packs — pure budget-bounded selection + async worker (patent-sensitive)"
```

---

### Task 6: Output #2 — nothing silently goes stale (ASYNC) (TDD)

> **Patent-sensitive (spec §10): the stale-artifact propagation runtime.** Keep design internal.

**Files:**

- Create: `libs/knowledge-runtime/src/workers/stale-propagation.worker.ts` (+ spec)

**Interfaces:**

- Produces: `StalePropagationWorker` — consumes a `propagate-stale` job triggered by a `knowledge:SourceChanged.v1` (or `ReferenceBroken`) observation; computes the review-required set as `impactOf(corpus, changedId)` over the S1 backlink index; emits a `requires-review` signal per affected node (a `knowledge:QueriedByAgent`-sibling review-queue event or a review-queue row — chosen here) and invalidates the affected nodes' freshness posterior + the S1 `BacklinkIndexService` cache. Strictly off the request path.

- [ ] **Step 1: Write the failing test** (in-process queue + fake corpus): a `SourceChanged(B)` job, with B cited by A and C and A cited by D, queues review for exactly `{A, C, D}` (the transitive `impactOf`), deterministically, and is idempotent on replay (re-running the job does not double-queue). Assert the quality bar: nothing in the impact set is left unflagged ("nothing silently goes stale" — spec §4/§6) AND nothing *outside* the impact set is flagged (no false propagation).

- [ ] **Step 2: Run → fail. Write the worker.** Trigger wiring: the `ObservationEmitterService` (Task 2), after `publishAll` commits, enqueues a `propagate-stale` job (fire-and-forget; the emit transaction is never blocked on propagation). Run → pass.

- [ ] **Step 3: Gate + commit.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-runtime/src/workers/stale-propagation.worker.ts libs/knowledge-runtime/src/workers/stale-propagation.worker.spec.ts
git commit -m "feat(knowledge): stale propagation — impactOf review-set on source change, async + idempotent (patent-sensitive)"
```

---

### Task 7: Embedding refresh worker (ASYNC) (TDD)

**Files:**

- Create: `libs/knowledge-runtime/src/workers/embedding-refresh.worker.ts` (+ spec)
- Create: `libs/knowledge-contracts/src/embedding-port.ts` (the `EmbeddingPort` interface, if not already stubbed in S1) (+ spec)

**Interfaces:**

- Produces:
  - `interface EmbeddingPort { embed(text: string): Promise<readonly number[]> }` + `EMBEDDING_PORT` token (OQ3: a default adapter is chosen here — model + dimension must match S1's `EMBEDDING_DIM`; record both in the S0 ADR follow-up).
  - `EmbeddingRefreshWorker` — consumes a `refresh-embedding` job (triggered by `SourceChanged` or a node create/update), recomputes the embedding via `EmbeddingPort`, and upserts the S1 `RetrievalPort` record. Off the request path; a content-change enqueues a refresh, never computes inline.

- [ ] **Step 1: Write the failing test** with a deterministic fake `EmbeddingPort` (text → fixed vector) + the S1 `RetrievalPort` in-memory double: a `refresh-embedding` job upserts the right `RetrievalRecord`; a `SourceChanged` enqueues exactly one refresh job; the worker is idempotent.

- [ ] **Step 2: Run → fail. Write the port + worker.** Run → pass.

- [ ] **Step 3: Gate + commit + push.**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-contracts/src/embedding-port.ts libs/knowledge-runtime/src/workers/embedding-refresh.worker.ts libs/knowledge-runtime/src/workers/embedding-refresh.worker.spec.ts
git commit -m "feat(knowledge): async embedding-refresh worker (OQ3 model/dim recorded; off the request path)"
git push -u origin feat/s2-twin
```

---

### Task 8: PR + verifier wave

- [ ] **Step 1: Open `de-braighter/knowledge#<n>`** (branch `feat/s2-twin`). PR body lists the S2 deliverables, **flags the two patent-sensitive runtimes (§10)**, and carries the twin-ritual lines:

```text
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effort: deep
Effect: cycle-time 0.01±0.02 expert; findings <one per 200 LoC>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 2: Verifier wave** (non-trivial: event types + inference registration + three async workers) → full wave in parallel, `isolation: "worktree"`: `local-ci` + `reviewer` + `charter-checker` + `qa-engineer`. **`qa-engineer` MUST verify the async invariant** — none of context-pack derivation, stale propagation, or embedding refresh runs in a request path (a violation is blocking, spec §6). `charter-checker` certifies: observations ride the published publisher (kernel validates envelope only), posteriors ride the published backbone + pure ObservationProjections (kernel learns no knowledge semantics), derived-not-stored holds, zero kernel change. Post findings before merge; then `npm run ritual:post-merge`.

---

## Self-Review

**Spec coverage (S2):** §4 lifecycle ops → observations (SourceChanged/ReferenceBroken/ReferenceRetargeted on update/move/drop, exact citer set from `whoCites`) → Tasks 1/2. §4 derived labels (affected-by/requires-review/citation-stale/decision-at-risk/evidence-missing) → Task 4. §6 S2 concern #2 (observation log) → Tasks 1/2; concern #3 (freshness/relevance/confidence/impact posteriors) → Tasks 3/4. §6 output #1 minimal valid context packs → Task 5; output #2 nothing silently goes stale → Task 6. §6 "all three async / off the request path" → Tasks 5/6/7 + the async Global Constraint + the qa gate. §10 patent-sensitive runtimes → Tasks 5/6 flagged. OQ3 embedding → Task 7. S1 untouched (consumed, not rebuilt) → by construction (S2 only adds files). S3 provenance/run-manifest pinning is explicitly out of S2.

**Placeholder scan:** no TBD/TODO; pure-logic code (events, labels, context-pack selection) is complete; the inference-catalog + queue-adapter tasks specify the confirm-at-execution preconditions (read the installed InferenceCatalog/ObservationProjection `.d.ts`; choose the queue adapter) the house style uses for substrate-registration + infra choices.

**Type consistency:** `KNOWLEDGE_EVENT_TYPES`/builders (Task 1) consumed by the emitter (Task 2); `KNOWLEDGE_INDICATORS`/`buildKnowledgeInferenceCatalog` (Task 3) consumed by `TwinReadoutService` (Task 4); `TwinLabel`/`deriveLabels` (Task 4) consumed by the readout; `NodeWithCites`/`whoCites`/`impactOf` (S1) consumed by Tasks 2/5/6; `ContextPack`/`deriveContextPack` (Task 5) + `JobQueue` consumed by the worker; `EmbeddingPort`/`RetrievalPort` (S1+Task 7) consumed by the refresh worker.

## Risks / open questions

- **Inference-family fit** — modeling freshness/relevance/confidence/impact as conjugate posteriors (Beta-Binomial/Normal-Normal) is a modeling choice within the backbone's Phase-1 families; if a dimension needs a non-conjugate family it returns `not-implemented-phase-1` and the label degrades to `evidence-missing` (Task 4) rather than forcing a kernel inference change (which would be a STOP). Re-evaluate per dimension at execution.
- **Queue infrastructure** — pg-boss (Postgres-backed) avoids new infra but adds a layer-owned ops table; the in-process fallback keeps tests + single-process dev green. Decide in Task 5 Step 1; keep everything behind the `JobQueue` port.
- **Patent sensitivity** — Tasks 5/6 are the disclosure candidates; internal-only until attorney review (spec §10).
