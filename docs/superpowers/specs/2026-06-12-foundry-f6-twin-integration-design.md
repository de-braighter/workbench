# F6 — Foundry twin integration (foundry events → devloop + wave advisory)

**Date:** 2026-06-12 · **Status:** founder-approved design · **Parent:**
`2026-06-09-foundry-multi-product-machine-design.md` §6 (sub-project F6, the last unshipped one)

## 1. Goal

Close the loop the foundry machine was designed around: the devloop twin ingests the foundry's
operational exhaust (claim / queue / gate dynamics it cannot see from GitHub), derives flow
readouts from it, and feeds per-verifier precision back into wave composition — **advisorily**.
After F6 the F1–F6 machine is complete as specced.

Both sides were pre-staged for this: every foundry event is a validated kernel
`DomainEventEnvelope` (same schema import as devloop's events), and foundry's `append()` mints a
UUID `eventId` documented as "the stable dedup/reference key for downstream consumers (devloop
F6)". The log **file** is the integration contract — devloop never imports foundry code.

## 2. Founder decisions (this design session)

| Decision | Choice |
| --- | --- |
| Wave-feedback authority | **Advisory readout** — `wave <repo>` recommends with evidence; sessions/humans decide. No generated config, no foundry-prompt embedding. |
| Readouts shipped now | **Queue + claim flow** and **end-to-end lead time** (cross-log join). Gate latency deferred. |
| Transport | **Pull-ingest with eventId dedup** (devloop pattern peer to `ingest/github.ts`, `ingest/sonar.ts`). Push-at-transition and read-in-place rejected (two writers / multi-source plumbing). |

## 3. Components

Three units in `domains/devloop`, one doc touch in the workbench. No foundry-repo change.

### 3.1 Ingest — `src/ingest/foundry.ts`, CLI `ingest-foundry`

- Source path: `FOUNDRY_LOG` env, default `<devloop pkg root>/../foundry/data/events.jsonl`
  (sibling clone in the cluster).
- Read + schema-validate every source envelope; collect the `eventId`s of events already in the
  devloop log with `packId === 'foundry'`; append the rest **verbatim** — original `tenantPackId`,
  `packId`, `actorRef`, `occurredAt` preserved as provenance. No re-stamping, no translation.
- All event types ingest, heartbeats included (append-only fidelity; readouts ignore them).
- Idempotent by construction: a second run appends 0. A source event without an `eventId` is a
  contract violation → fail loud.
- Ritual wiring: `ritual:post-merge` gains `ingest-foundry` as a **non-blocking** step.

Safety note: existing devloop folds select by `eventType` (`ofType(events, 'devloop:…')`), so
`foundry:*` events are inert in current readouts. The implementation plan includes a cheap sweep
confirming no consumer (snapshot, KG, dashboard) assumes every log event is devloop-pack.

### 3.2 Flow readout — `src/inference/flow.ts`, CLI `flow [productKey]`

Pure fold over `foundry:*` events into per-item ladders:

- **Per item:** `queuedAt` → claims `[{acquiredAt, releasedAt?, outcome?, sessionId}]` →
  derived: time-in-queue (queued → first claim), active-claim duration, terminal state
  (`done` is the only terminal outcome — `blocked`/`abandoned` re-queue, matching F1 semantics),
  re-queue count, stale flag (unreleased claim past `acquiredAt + ttlMinutes`).
- **Per product:** items queued / in-flight / done, blocked + abandoned counts, median
  time-in-queue, median released-claim duration. No `productKey` argument → all products,
  one summary block each.
- **End-to-end lead time (the cross-log join):** for released items with a `prRef`
  (`owner/repo#pr`, proven live format), look up devloop `PrOpened` / `PrMerged` for that
  repo + pr → the full ladder *queued → claimed → PR opened → merged* with stage durations.
  prRef present but PR events absent → render the foundry-only ladder plus a hint:
  `PR not in twin log — run: backfill <owner/repo>`.

### 3.3 Wave advisory — `src/inference/wave.ts`, CLI `wave <owner/repo>`

Renders the existing `findingsSummary()` per-verifier precision with deterministic, stated rules:

- No findings data for the repo → `standard wave — no findings history` (the default 4-verifier
  wave from `workflows/verifier-wave.md`, + `exercir-charter-checker` on exercir).
- Per verifier: `resolvable < 5` → `insufficient data (n=…) — keep, standard wave`;
  `precision ≥ 0.5` → `keep (precision …, n=…)`;
  `precision < 0.5` → `low precision — re-prompt or replace (advisory; evidence: …)`.
- Output is always advice with evidence and sample size — never a config artifact. Thresholds
  (n=5, 0.5) are named constants surfaced in the output so the advice is self-explaining.

### 3.4 Workbench doc touch

`workflows/verifier-wave.md` gains one short "Consult the twin" paragraph: before composing a
wave on a repo with PR-findings history, run `npm run dev -- wave <owner/repo>` in
`domains/devloop` and weigh the advice. Foundry session prompts are unchanged.

## 4. Error handling / failure stances

- Foundry log missing → `ingest-foundry` reports the path and exits 0 (the ritual never blocks
  on a sibling clone being absent).
- Corrupt source line → fail loud with the line number (mirrors foundry's own reader).
- `flow` with no foundry events in the log → tells the operator to run `ingest-foundry` first.
- Unparseable `prRef` → item renders with a provenance note instead of a join; never throws.

## 5. Testing

- **Ingest:** fixture foundry JSONL in a temp dir → run twice → second run appends 0; corrupt
  line throws with line number; missing file no-ops; verbatim-preservation asserted
  (`packId`/`tenantPackId`/`eventId` unchanged).
- **Flow:** synthetic ladders built as local fixture envelopes (the schema is the shared
  contract — fixtures do **not** import foundry code): happy path, re-queue after `abandoned`,
  stale claim, prRef join hit, prRef join miss.
- **Wave:** fixtures for no-data, thin-data (n<5), low-precision, and healthy verifiers.

## 6. Deliberately deferred

Gate-latency readout (GateRequested→GateDecided) · generated per-repo wave config ·
foundry-prompt-embedded wave advice · the conductor (full session automation) · F1 retire-op.
