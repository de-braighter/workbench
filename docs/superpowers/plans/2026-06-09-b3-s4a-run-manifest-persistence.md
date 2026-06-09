# B3-S4a — F1-Event-Sourced Run-Manifest Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. **Build with the `substrate-coder-pro` agent.** Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the production auto-persist mechanism ADR-220 designed but never built — a successful `INFERENCE_BACKBONE.posterior()` with `RunOptions.manifest:'event'` emits a `kernel.InferenceRunCompleted.v1` F1 event AND eagerly persists the derived `kernel.run_manifest` index row, so `replay(id)` finds it. Family-agnostic (proven on Normal; serves all families incl. survival). No async projector (deferred); no always-on default (deferred).

**Architecture:** A new `InferenceRunRecorder` service encapsulates the emit+persist; the `InferenceBackboneRouter.posterior()` calls it once after a successful, manifest-bearing, `manifest:'event'` dispatch (the single family-agnostic choke point). The recorder resolves the `eventLogThroughSeq` slice bound (provenance-only, the asOf-only freeze posture is unchanged), builds the `InferenceRunCompleted.v1` envelope + the `RunManifestRecord` from the handle+input via a promoted production `recordFrom`, and writes both. **Design:** `layers/specs/concepts/design/2026-06-09-f1-event-sourced-run-manifest-persistence.md` (rides ADR-220; no new ADR). The `InferenceRunCompleted.v1` payload schema is an additive Ring-0 minor bump — **shipped UNPUBLISHED** (matching S3.5; coordinated publish later).

**Tech Stack:** TypeScript (ESM `.js`), Vitest, NestJS DI, Prisma (`kernel.event_log` + `kernel.run_manifest` via `GucPrismaRunner` + the `DomainEventPublisher` outbox). Repo: `layers/substrate`. Builds on S3.5 (merged, `b71c19b`). Stays 1.2.0 (unpublished).

**Repo + branch:** from `layers/substrate`, `git fetch origin && git checkout -b feat/b3-s4a-run-manifest-persistence origin/main` (cut off origin/main — stale-local-main gotcha).

**Conventions:** ESM `.js` imports; reproducibility/events types via their subpaths; `Result<T,E>` at fallible boundaries; no throw across the inference port (the recorder must NEVER fail a posterior — a persist failure is logged + swallowed OR rolls back its own tx, never propagates to the caller; see Task 3). One commit per task; TDD. No publish.

**READ FIRST (verbatim shapes — absolute paths + the gathered line refs):**
- `libs/substrate-contracts/src/events/domain-event-publisher.port.ts:25-37` (`publishAll(events, tx)`) + `:47-49` (`DOMAIN_EVENT_PUBLISHER` token).
- `libs/substrate-contracts/src/events/domain-event.schemas.ts:43-60` (`DomainEventMetadataSchema`) + `:62-95` (`DomainEventEnvelopeSchema`: `eventId?`, `tenantPackId`, `packId` nullable, `aggregateType`, `aggregateId`, `eventType`, `eventVersion` default 1, `payload` record, `metadata`, `occurredAt`).
- `libs/substrate-runtime/src/events/in-memory-domain-event-publisher.ts` (the proof double: `publishAll`, `drain()`, `reset()`).
- `libs/substrate-runtime/src/events/prisma-outbox.writer.ts:78-119` (the production `publishAll` — writes `event_log` + `outbox` in the caller's `tx`).
- `libs/substrate-runtime/src/inference/inference-backbone-router.ts:149-196` (constructor) + `:198-236` (`posterior()` — the emit choke point; note the exhaustiveness `default`).
- `libs/substrate-runtime/src/reproducibility/replay.service.proof.spec.ts:106-124` (the test-only `recordFrom` to promote).
- `libs/substrate-contracts/src/reproducibility/run-manifest-repository.port.ts:50-101` (`RunManifestRecord`; `eventLogThroughSeq: bigint`; `posteriorSummary: PosteriorSummaryOrSurvival`).
- `libs/substrate-contracts/src/primitives/run-manifest.ts:61-77` (`RunManifestSchema`).
- `libs/substrate-contracts/src/primitives/run-options.ts:14-53` (`RunOptions.manifest?: 'emit'|'omit'|'event'`, default `'emit'`; plain interface, no Zod).
- `libs/substrate-runtime/src/reproducibility/in-memory-run-manifest-repository.ts` (`persist`/`getById`, keyed `(tenant,id)`, `conflict` on dup) + `prisma-run-manifest-repository.ts:98` (`eventLogThroughSeq` read `BigInt(row...)` / write `.toString()`) + `:99` (the cast bug).
- `libs/substrate-runtime/src/inference/adapters/prisma-evidence-log.repository.ts:383-407` (the `GucPrismaRunner.run(tenant, tx => $queryRawUnsafe(...))` pattern to mirror for the MAX(seq) query).
- `libs/substrate-runtime/src/composition-root/substrate.module.ts:486-500` (the `RUN_MANIFEST_REPOSITORY` binding doc) + the `INFERENCE_BACKBONE`/router provider + the `DOMAIN_EVENT_PUBLISHER` binding.

---

## Task 1: The `InferenceRunCompleted.v1` contract (event constant + payload Zod schema)

**Files:**
- Modify/Create: a contracts module under `libs/substrate-contracts/src/reproducibility/` (e.g. `inference-run-completed.ts`) + barrel export.
- Test: `inference-run-completed.spec.ts` (new).

- [ ] **Step 1:** Confirm whether a Zod `RunManifestRecordSchema` already exists (grep `RunManifestRecordSchema` in `libs/substrate-contracts`). The recordFrom builds a plain `RunManifestRecord`; the payload schema needs a Zod mirror. If `RunManifestRecordSchema` does NOT exist, define it in this task (mirroring the `RunManifestRecord` type at `run-manifest-repository.port.ts:50-101`, reusing `RunManifestSchema`, `SubjectRefSchema`, and `PosteriorSummaryOrSurvivalSchema`). Then the payload schema is `RunManifestRecordSchema.omit({ createdAtIso: true })`.

- [ ] **Step 2: Write the failing test** (`inference-run-completed.spec.ts`):
```typescript
import { describe, expect, it } from 'vitest';
import {
  INFERENCE_RUN_COMPLETED_EVENT_TYPE,
  InferenceRunCompletedPayloadSchema,
} from './inference-run-completed.js';

describe('InferenceRunCompleted.v1 (B3-S4a)', () => {
  it('the event-type constant is the pinned kernel literal', () => {
    expect(INFERENCE_RUN_COMPLETED_EVENT_TYPE).toBe('kernel.InferenceRunCompleted.v1');
  });

  it('accepts a well-formed payload (the RunManifestRecord minus createdAtIso)', () => {
    const payload = {
      id: '11111111-1111-1111-1111-111111111111',
      tenantPackId: '22222222-2222-2222-2222-222222222222',
      method: 'posterior',
      manifest: {
        requestId: '11111111-1111-1111-1111-111111111111',
        seed: 12345, engineVersion: 'e@1', catalogVersionHash: 'a'.repeat(64),
        inputHash: 'b'.repeat(64), apiVersion: 'v1',
        policy: { strategy: 'conjugate-fast-path', seed: 12345 },
        startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', warnings: [],
      },
      treeRootId: null,
      subjectRef: { kind: 'individual', id: '33333333-3333-3333-3333-333333333333', role: 'x' },
      indicatorKey: 'k',
      asOfIso: null,
      eventLogThroughSeq: '42', // wire form: decimal string (JSONB)
      posteriorSummary: { distributionRef: 'normal@1', parameterValues: { mean: 0, sd: 1 }, mean: 0, p10: -1.28, p50: 0, p90: 1.28, sd: 1 },
    };
    expect(InferenceRunCompletedPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('accepts a survival posteriorSummary (the discriminated union widen)', () => {
    // …same payload but posteriorSummary = { kind:'survival', familyRef:'survival.weibull-aft@1', parameterValues:{scale:10,shape:2}, survivalAtHorizons:[{t:5,s:0.78}], medianSurvival:8.3, quantiles:[{p:0.25,t:5}], hazardAtHorizon:{t:10,h:0.2}, appliedHazardRatio:1 } → success
  });

  it('rejects a payload missing the manifest tuple', () => {
    // drop `manifest` → success === false
  });
});
```
(Flesh out the survival case from the SurvivalSummary fixture; align `subjectRef`/`SubjectRef` to the real schema — read it.)

- [ ] **Step 3: Implement** `inference-run-completed.ts`:
```typescript
import { z } from 'zod';
import { RunManifestRecordSchema } from './run-manifest-repository.port.js'; // or wherever it lands (Step 1)

/** The pinned kernel event type for a completed, manifest-bearing inference run
 *  (ADR-220 §Decision 1; the F1 audit source-of-truth `kernel.run_manifest` indexes). */
export const INFERENCE_RUN_COMPLETED_EVENT_TYPE = 'kernel.InferenceRunCompleted.v1' as const;

/** The F1 event payload IS the RunManifestRecord tuple minus the DB-stamped
 *  `createdAtIso` (the index stamps that on insert; the event carries
 *  `manifest.completedAt`). `eventLogThroughSeq` serializes as a decimal STRING
 *  on the JSONB wire (bigint), coerced back on read. The `posteriorSummary`
 *  reuses the PosteriorSummaryOrSurvival union → a survival summary validates free. */
export const InferenceRunCompletedPayloadSchema = RunManifestRecordSchema
  .omit({ createdAtIso: true })
  .extend({ eventLogThroughSeq: z.union([z.string(), z.number()]).transform((v) => BigInt(v)) });
// NOTE: if RunManifestRecordSchema already types eventLogThroughSeq as bigint, reconcile the
// wire-string coercion — the JSONB stores a string; the schema parses string|number → bigint.

export type InferenceRunCompletedPayload = z.infer<typeof InferenceRunCompletedPayloadSchema>;
```
Export both from the reproducibility barrel (`index.ts`). **CONFIRM** the `eventLogThroughSeq` wire/parse shape against how `prisma-run-manifest-repository.ts:98` reads it (`BigInt(row...)`) — the payload must round-trip the same way.

- [ ] **Step 4: Run — expect PASS.** `npx vitest run libs/substrate-contracts/src/reproducibility/inference-run-completed.spec.ts` + `npx vitest run libs/substrate-contracts` (no regression). **Step 5: Commit** `feat(substrate-contracts): InferenceRunCompleted.v1 event type + payload schema (B3-S4a; unpublished)`.

---

## Task 2: Promote `recordFrom` to a production runtime helper

**Files:**
- Create: `libs/substrate-runtime/src/reproducibility/record-from.ts`
- Test: `libs/substrate-runtime/src/reproducibility/record-from.spec.ts`
- Modify: `replay.service.proof.spec.ts` (import the promoted helper instead of its local copy — keep the proof green).

- [ ] **Step 1: Write the failing test** asserting `recordFrom(handle, input, seq)` produces the exact `RunManifestRecord` (mirror the proof spec's local mapping). Build a `PosteriorHandle` fixture + a `PosteriorInput` + a `bigint` seq → assert every field maps (id=manifest.requestId, tenantPackId, method:'posterior', manifest, treeRootId=treeRoot, subjectRef=subject, indicatorKey, asOfIso=asOf??null, eventLogThroughSeq, posteriorSummary=summary, createdAtIso=manifest.completedAt).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `record-from.ts` — promote the proof spec's `recordFrom` (`:106-124`) VERBATIM as an exported function (signature `recordFrom(handle: PosteriorHandle, input: PosteriorInput, eventLogThroughSeq: bigint): RunManifestRecord`). Then edit `replay.service.proof.spec.ts` to import it + delete the local copy.
- [ ] **Step 4: Run — PASS** (the new spec + the existing proof spec stay green). **Step 5: Commit** `refactor(substrate-runtime): promote recordFrom to a production helper (B3-S4a)`.

---

## Task 3: The `InferenceRunRecorder` service (emit + eager persist)

**Files:**
- Create: `libs/substrate-runtime/src/reproducibility/inference-run-recorder.ts` + its DI token.
- Test: `libs/substrate-runtime/src/reproducibility/inference-run-recorder.spec.ts`

The recorder encapsulates the F1 emit + the eager index persist + the slice-bound resolution. Injected into the router (Task 4). It must be **total** — a recording failure NEVER fails the posterior (log + swallow, or roll back its own writes; the caller already has the handle).

Deps (constructor): `DomainEventPublisher` (`DOMAIN_EVENT_PUBLISHER`), `RunManifestRepository` (`RUN_MANIFEST_REPOSITORY`), and a `GucPrismaRunner` (for the MAX(seq) query + the emit tx) — OR an in-memory equivalent for the proof. Behavior of `record(handle, input, method='posterior')`:
1. Resolve `eventLogThroughSeq` — the MAX(`sequence`) over `kernel.event_log` for the run's slice. **Query pattern** (mirror `prisma-evidence-log.repository.ts:383-407`): `runner.run(tenantPackId, tx => tx.$queryRawUnsafe('SELECT COALESCE(MAX(sequence),0)::text AS seq FROM kernel.event_log WHERE tenant_pack_id = $1::uuid', tenantPackId))` → `BigInt(rows[0].seq)`. (Scope to tenant; subject/indicator filtering is provenance-optional per the design §2.3 — keep it tenant-wide for v1 simplicity, or scope to the subject's aggregate_id — CONFIRM the cheapest correct bound; tenant-wide MAX is a safe upper bound for provenance.) For the in-memory proof, inject a seq provider returning a fixed bigint.
2. Build the record: `const record = recordFrom(handle, input, seq)`.
3. Build the envelope: `eventType: INFERENCE_RUN_COMPLETED_EVENT_TYPE`, `aggregateType: 'InferenceRun'`, `aggregateId: record.id` (the run is its own aggregate; it's a UUID — confirm `manifest.requestId` is a UUID), `packId: null` (kernel-wide), `tenantPackId: record.tenantPackId`, `eventVersion: 1`, `payload: <the record minus createdAtIso, with eventLogThroughSeq as a decimal string>`, `metadata: { actorRef: <subjectRef-as-provenance>, catalogVersionHash: record.manifest.catalogVersionHash, requestId: record.manifest.requestId }`, `occurredAt: record.manifest.completedAt`.
4. **Write both (R3 — the transaction shape; resolve at build, two sanctioned options):**
   - **(R3-ordered, RECOMMENDED for S4a):** `await runner.run(tenant, tx => publisher.publishAll([envelope], tx))` (the F1 event — the source of fact), THEN `await repo.persist(record)` (the derived index, its own runner tx). Event-first; if persist fails, the event is still the source + the index is re-derivable (recoverable). NO port widen. Log a persist failure; do not throw.
   - **(R3-atomic, the follow-up):** add an optional `tx?` to `RunManifestRepository.persist(record, tx?)` so both join one `runner.run` tx (`publishAll([env],tx)` + `persist(record,tx)`). Atomic, no transient window — but widens the port (contracts surface). DEFER unless trivial.
   Pick R3-ordered for S4a; record R3-atomic as the follow-up. **Wrap the whole `record()` in try/catch — a recording failure logs (`event:'inference.run_record_failed'`) and returns; it never propagates to the posterior caller.**

- [ ] **Step 1: Write the failing test** (in-memory): construct the recorder with an `InMemoryDomainEventPublisher` + `InMemoryRunManifestRepository` + a fixed-seq provider. Call `recorder.record(handle, input)`. Assert: (a) the publisher `.drain()` has ONE envelope with `eventType==='kernel.InferenceRunCompleted.v1'`, `packId===null`, `aggregateType==='InferenceRun'`, `payload.id===handle.manifest.requestId`; (b) `repo.getById(tenant, handle.manifest.requestId)` returns the persisted record bit-identical to `recordFrom(handle, input, seq)`; (c) the persisted `posteriorSummary` deep-equals the event payload's (R1 — index carries no fact the event lacks); (d) a recorder whose repo.persist returns `conflict`/throws does NOT throw out of `record()` (totality).
- [ ] **Step 2: Run — FAIL. Step 3: Implement** per above (R3-ordered). **Step 4: Run — PASS. Step 5: Commit** `feat(substrate-runtime): InferenceRunRecorder — F1 emit + eager run_manifest persist (B3-S4a)`.

---

## Task 4: Router emit hook (gated on `manifest:'event'` + ok + manifest-bearing)

**Files:**
- Modify: `libs/substrate-runtime/src/inference/inference-backbone-router.ts`
- Test: `libs/substrate-runtime/src/inference/inference-backbone-router.run-recording.spec.ts` (new)

- [ ] **Step 1: Write the failing test:** build a router (mirror the existing router-spec harness) with an injected recorder (an in-memory recorder double capturing `record()` calls, OR the real recorder over in-memory publisher+repo). Assert:
  - a `posterior(input, { manifest: 'event' })` that returns `ok` with a manifest-bearing handle → the recorder was called ONCE with (handle, input).
  - `posterior(input, { manifest: 'omit' })` → recorder NOT called.
  - `posterior(input)` (no opts / default `'emit'`) → recorder NOT called (only `'event'` triggers persist).
  - a `posterior` that returns `err` → recorder NOT called.
  - a handle with NO manifest (if reachable) → recorder NOT called.
  - the posterior RESULT is byte-unchanged regardless of recording (the recorder is a side effect; the returned handle is the dispatch's).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — inject the recorder into the router constructor (a new `@Inject(INFERENCE_RUN_RECORDER)` after the existing five; the recorder is bound in the composition root, Task 5). Refactor `posterior()` so it captures the dispatch result, and on `result.ok && opts?.manifest === 'event' && result.value.manifest !== undefined` calls `await this.recorder.record(result.value, input)` (awaited, but its failure can't propagate — Task 3 totality), THEN returns the result. Keep the dispatch switch byte-unchanged; wrap only the return. CONFIRM the `PosteriorHandle` has a `.manifest` field (it does — `handle.manifest`).
- [ ] **Step 4: Run — PASS** + the full inference suite (`npx vitest run libs/substrate-runtime/src/inference`) — no regression (existing router specs that don't pass `manifest:'event'` see no recorder call; if they construct the router without a recorder, provide a no-op default or update the harness). **Step 5: Commit** `feat(substrate-runtime): router emits InferenceRunCompleted + persists on manifest:'event' (B3-S4a)`.

---

## Task 5: Composition-root wiring + the cast-bug fix

**Files:**
- Modify: `libs/substrate-runtime/src/composition-root/substrate.module.ts`
- Modify: `libs/substrate-runtime/src/reproducibility/prisma-run-manifest-repository.ts` (the cast fix)

- [ ] **Step 1 (cast fix):** `prisma-run-manifest-repository.ts:99` — change `row.posterior_summary as PosteriorSummary` → `as PosteriorSummaryOrSurvival` (import the union from the inference subpath; it's what the port already declares at `run-manifest-repository.port.ts:98`). This is the persistence path S4a is the first to exercise; without it a survival summary reads back with `kind` dropped.
- [ ] **Step 2 (wiring):** bind `INFERENCE_RUN_RECORDER` in `SubstrateModule.forRoot` — construct the `InferenceRunRecorder` over the bound `DOMAIN_EVENT_PUBLISHER` + `RUN_MANIFEST_REPOSITORY` + a `GucPrismaRunner` (mirror how `RUN_MANIFEST_REPOSITORY` derives its runner). Inject `INFERENCE_RUN_RECORDER` into the `InferenceBackboneRouter` provider (the router gains the 6th constructor arg). CONFIRM the `DOMAIN_EVENT_PUBLISHER` binding exists (the prod `PrismaOutboxWriter` + the in-memory double); if the default binding is absent, add it mirroring `RUN_MANIFEST_REPOSITORY`'s auto-derive (prod when a real prismaClient is present; in-memory otherwise).
- [ ] **Step 3:** `npm run ci:local` (DB-free) green — the module composes, the router constructs with the recorder, no regression. **Step 4: Commit** `feat(substrate-runtime): wire InferenceRunRecorder into the router + fix posteriorSummary cast (B3-S4a)`.

---

## Task 6: End-to-end Normal proof + DB-gated persist/replay + gate + PR + wave

**Files:**
- Test: `libs/substrate-runtime/src/reproducibility/run-manifest-persistence.proof.spec.ts` (new, DB-free end-to-end) + extend the DB-gated reproducibility spec.
- Modify: both CHANGELOGs `[Unreleased]`.

- [ ] **Step 1 (DB-free end-to-end proof):** wire a real `InferenceBackboneRouter` + `InferenceRunRecorder` over in-memory publisher + in-memory run-manifest repo + an in-memory catalog/evidence with a Normal indicator. `posterior(input, { manifest:'event' })` → assert: an `InferenceRunCompleted.v1` event was published (publisher.drain()), the run_manifest was persisted (`repo.getById`), AND `ReplayService.replay(tenant, id)` returns `ok` + bit-identical. Negative: `manifest:'omit'` → no event, no persist; cross-tenant `getById` → `not-found`.
- [ ] **Step 2 (DB-gated, optional-if-cheap):** a DB-gated spec persisting via the real `PrismaOutboxWriter` + `PrismaRunManifestRepository` over `substrate-postgres` proving the event_log row + the run_manifest row land + `getById` reads back (RLS-scoped). Gate on `SUBSTRATE_DATABASE_URL`, run via `--config vitest.db.config.ts` (the S3.5 lesson). If the R3 tx-unification proves hard live, the ordered-writes path still works — assert both rows exist.
- [ ] **Step 3 (changelogs):** contracts `[Unreleased]` — the `InferenceRunCompleted.v1` event type + payload schema (additive, **unpublished**). runtime `[Unreleased]` — the `InferenceRunRecorder` + the router emit hook + the cast fix.
- [ ] **Step 4 (gate):** `npm run ci:local` green (report counts) + `npm run ci:local:db` (or the explicit DB-config command) for the DB-gated proof.
- [ ] **Step 5 (PR):** push + `gh pr create --body-file -` (NOT `--body @-`). Body: scope (the F1-event-sourced persistence mechanism, family-agnostic, proven on Normal; emit gated on `manifest:'event'`; eager dual-write R3-ordered; the cast fix; **unpublished**, stays 1.2.0). Kernel-minimality (one Ring-0 event schema, two ports into the router, zero new tables; ADR-176 verdict in the design note). `Producer: orchestrator/claude-opus-4-8 [substrate-architect, writing-plans, subagent-driven-development]` · `Effort: deep` · `Effect: cycle-time 0.01±0.02 expert` · `Effect: findings 2±2 expert`. `Tech design:` the F1-persistence design note + ADR-220. "Part of B3-S4 (ADR-223 §6)."
- [ ] **Step 6 (wave):** `reviewer` + `charter-checker` (the ADR-176 verdict — concern #4 reproducibility, the event-is-generator/index-is-derived-view ADR-176 §4; the eager-persist still-a-derived-index; zero new tables) + `qa-engineer` (the R1 index==event-payload deep-equal, the R2 short-circuit cases, the R3 transaction/totality — a persist failure never fails the posterior, the cross-tenant RLS), all `isolation:worktree`; + ci:local as local-ci. Automerge on green (rebase onto origin/main first if behind; re-gate). Twin ritual. Update memory (S4a done → S4b next).

---

## Self-Review (plan author)

**Spec coverage (design note §§2-7):** the `InferenceRunCompleted.v1` event constant + payload schema (§2.1-2.2) → Task 1; the production `recordFrom` (§7 S4a item 2) → Task 2; the router emit at the choke point (§2) + the eager publish-then-persist (§4) + the slice-bound resolution (§2.3 source 2) + totality → Task 3+4; the trigger gate `manifest:'event'` (§5) → Task 4; composition-root wiring (§7 item 5) + the cast fix (§7 item 6 / R7) → Task 5; the Normal end-to-end proof (§7 item 7) + RLS → Task 6. R1 (index==event deep-equal) → Task 3 test; R2 (short-circuits) → Task 4 tests; R3 (tx shape) → Task 3 (R3-ordered, atomic deferred); R4 (provenance-only seq) → Task 3 step 1 (unchanged freeze posture, noted); R6 (no always-on) → Task 4 (only `'event'`).

**Placeholder scan:** the contract (Task 1), recordFrom (Task 2, verbatim promote), the recorder (Task 3, full behavior + the R3 fork explicitly handed to the implementer), the router hook (Task 4), the wiring + cast fix (Task 5) are concrete. CONFIRM points (does `RunManifestRecordSchema` exist; the exact `eventLogThroughSeq` wire shape; the `DOMAIN_EVENT_PUBLISHER` default binding; the cheapest correct MAX-seq scope; whether the router harness needs a no-op recorder default) are explicit reads, not placeholders. R3's transaction shape is a sanctioned implementer decision per the design note ("confirm at implementation"), with the recommended option (R3-ordered) named.

**Type consistency:** `INFERENCE_RUN_COMPLETED_EVENT_TYPE` + `InferenceRunCompletedPayloadSchema` (Task 1) used by the recorder's envelope (Task 3). `recordFrom` (Task 2) → `RunManifestRecord` consumed by the recorder (Task 3) + the proof (Task 6). The recorder (Task 3) injected into the router (Task 4) + bound in the composition root (Task 5). `DomainEventPublisher.publishAll(events, tx)` + `RunManifestRepository.persist` (the existing ports) used by the recorder. `PosteriorSummaryOrSurvival` (the cast fix, Task 5) matches the port's declared type. The emit gate reads `opts.manifest === 'event'` (RunOptions, Task 4).
