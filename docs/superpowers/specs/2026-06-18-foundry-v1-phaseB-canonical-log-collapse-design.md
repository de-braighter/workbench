# Foundry v1 Phase B — Canonical Log Collapse

> Stage 1 of the autonomous Foundry ladder. Absorbs `domains/devloop`'s observation log into ONE
> canonical event log so the doing-machine and the SDLC twin sit on one kernel spine. Repoint, not
> rewrite. Green-first. Reversible. **Zero kernel change.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (canonical log + reader tolerance), `domains/devloop` (repoint readers/writers, delete ingest copy-step, migration), `layers/specs` (ADR-245).
- **Supersedes (homing clause only):** ADR-241 §3 (which homed the SDLC twin to `domains/foundry` but left the two physical logs split). ADR-245 ratifies the single-log collapse.
- **Predecessor:** ADR-244 (Phase A — conductor drives off the kernel plan tree).

## 1. Problem — two logs, two truths

Today the system event-sources into **two** append-only JSONL logs sharing the identical kernel
`DomainEventEnvelope` contract:

- **Foundry log** — `domains/foundry/src/log.ts` → `$FOUNDRY_DATA_DIR/events.jsonl`. Coordination
  events (`foundry:WorkItemQueued`, `ClaimAcquired`, `GateDecided`, `MergeRecorded`, …). Read by
  `state.ts` (`fold`) → `claimableItems`, and by `plan/frontier.ts` → `planFrontier`.
- **Devloop log** — `domains/devloop/src/log.ts` → `$DEVLOOP_LOG/events.jsonl` (a *separate* file).
  Holds devloop's **own** observation events (`devloop:PrOpened`, `VerdictRecorded`,
  `FindingRecorded`, `EffectObserved`, retros, calibration) **plus a verbatim COPY of foundry's
  events**, pulled by `ingest/foundry.ts` (`ingestFoundry()` reads foundry's log file, dedups by
  `eventId`, re-appends).

**The seam.** The split is *logistical, not structural* — both logs use the same envelope, no
schema mismatch. But it forces: (a) a copy-step (`ingestFoundry`) that re-stamps ingested events
with **ingest-time** `occurredAt` (not source-time), corrupting cross-source ordering; (b) foundry
events duplicated across two files; (c) two reader fleets that can silently diverge if the ingest
lags or drops an event. The kernel's third concern — *"flat the observation: an append-only event
log"* — is meant to be **one** spine, not two.

## 2. Decision — collapse to one canonical log (Slice 1A)

**The canonical log is foundry's `events.jsonl`.** Both the doing-machine's coordination events and
the twin's observation events append to it. Devloop's readers read it directly. The `ingestFoundry`
copy-step is **deleted** — there is nothing to copy when there is one log.

This is decomposed into two slices; **only Slice 1A is built now.**

### Slice 1A — Canonical log + native twin read (the seam-killer) — BUILD NOW

1. **One physical log.** Devloop's log-path config points at foundry's canonical `events.jsonl`.
   Devloop's `append()` writes there; devloop's `readEnvelopes()` reads there.
2. **Delete the copy-step.** Remove `ingest/foundry.ts` and its callers; foundry events are already
   in the canonical log natively.
3. **Reader tolerance (both directions).** Foundry's reader/`fold` must **skip event types it does
   not own** (the `devloop:*` namespace) rather than validate-and-throw. Devloop's reader already
   folds both namespaces. Invariant: *each reader folds only its own namespace + shared types; the
   other namespace is inert to it.*
4. **Idempotency via content-based dedup (RATIFIED).** Devloop events carry no `eventId` (the
   kernel mints one on persist if ever needed). Idempotency is achieved by **content `dedupKey`**
   (`eventType + canonical(payload)`) — the same mechanism devloop's existing `backfill` already
   uses and that has produced **0 collisions across ~4 230 own-events** in the live log. uuidv5
   per-event natural-key minting was considered and deferred (YAGNI: content-dedup is sufficient
   and avoids the burden of defining a natural key per event type). Safeguard: the cutover runbook
   includes a **pre-flight collision check** — count `devloop:*` events vs distinct dedupKeys; any
   shortfall must be resolved before the migration runs.
5. **Source-truthful `occurredAt`.** Devloop's own events carry source time (GitHub PR
   `createdAt`/`mergedAt`, verdict time) — already true for backfilled events; the ingest-time drift
   problem **disappears** with the copy-step.
6. **One-time migration + append-only ordering contract.** Append devloop's historical **own**
   events (those NOT already in the canonical log) into the canonical log, deduped by `dedupKey`,
   idempotent, with the pre-migration canonical log backed up. Devloop's historical *ingested*
   foundry events are skipped (already present natively).

   **Append-only integrity — no global reorder.** The canonical log is written in WRITE order and
   existing lines are NEVER reordered (doing so would corrupt the append-only invariant). The
   migration sorts devloop's historical own-events by `occurredAt` **among themselves** before
   appending, but the resulting canonical log is NOT globally time-sorted — foundry's existing
   lines precede the appended history. **Readers are responsible for temporal ordering.** They
   already sort by `occurredAt` where it matters (e.g. `flowSummary`, calibration windows). This
   is an explicit design invariant, not a defect.
7. **Green-first, then retire.** Run the **full devloop suite green** against the canonical log
   BEFORE retiring the separate devloop log (archive the old file; do not delete).

### Slice 1B — Physical twin absorption + devloop repo retirement — REASSESS AFTER 1A

Folding devloop's inference modules + CLI physically into `domains/foundry` and retiring the devloop
repo. **Not built now.** Slice 1A already places the twin on the one kernel spine (it reads the one
canonical log); 1B is a packaging consolidation, higher-risk against a LIVE repo, and gated on 1A
landing green. Recorded as a planned follow-on, decided post-1A.

## 3. Architecture & mechanism

```
                         ┌─────────────────────────────────────────────┐
   foundry doing-machine │   canonical events.jsonl  (ONE spine)        │  devloop twin
   appends foundry:*  ──▶ │  foundry:WorkItemQueued                      │ ◀── appends devloop:*
                         │  foundry:ClaimAcquired                       │
   reads foundry:*   ◀── │  devloop:PrOpened                            │ ──▶ reads devloop:* + foundry:*
   (skips devloop:*)     │  foundry:MergeRecorded                       │     (folds both)
                         │  devloop:VerdictRecorded …                   │
                         └─────────────────────────────────────────────┘
```

- **Namespacing** is the coordination contract: `foundry:*` vs `devloop:*`. Each `fold` filters its
  namespace (+ any shared/kernel types). No cross-namespace coupling.
- **Append-only, readers sort.** The log is written in WRITE order; no reordering of existing
  lines ever occurs. Readers sort by `occurredAt` locally when temporal order is required. The
  log is NOT globally time-sorted after migration (foundry history precedes appended devloop
  history); this is correct and expected.
- **No live stream.** File-based remains; a long-running reader re-reads the file (unchanged from
  today). An HTTP/MCP event stream is explicitly **out of scope** (YAGNI; note as future v1.1).

## 4. Acid test — must BITE

Per the arc's falsifier discipline (independently-authored fixtures + mutation that flips RED +
negative control + whole-branch review). The primary acid-test file is
`test/canonical-collapse.acid.test.ts` in `domains/devloop`.

1. **Red-on-seam mutation (THE seam-detector).** Remove ONE `devloop:*` observation event from the
   canonical log (simulating "it stayed behind in the old separate log"). A posterior changes; the
   equality assertion goes **RED**. If any event is not in the one canonical log, this test fails.
   This is the falsifier: if the test passes despite a missing event, it is not a real seam test.
2. **Negative control A** — appending an unrelated/no-op `foundry:*` event type does NOT move any
   devloop posterior (the test is not trivially sensitive to every line; foundry events are inert
   to devloop readers for this fixture).
3. **Bit-stability** — deterministic readers (those that do NOT use `Math.random`) recompute
   posteriors **identically** across multiple runs against the same canonical log. Note: `cycle-time`
   and `reliability` readers use unseeded `Math.random` internally — acid assertions use only
   deterministic readers (e.g. calibration hit-rate, event counts) to avoid flakiness.
4. **Order-robustness** — the posterior is invariant to the physical line order of the canonical log.
   A shuffled-but-content-identical log produces the same posterior (readers sort by `occurredAt`
   locally). This replaces the earlier "two-log equivalence" framing, which a whole-branch review
   found tautological (comparing two things that are always identical by construction does not
   exercise the seam).
5. **Negative control B (foundry side) — `domains/foundry/test/reader-tolerance.test.ts`.** Foundry's
   coordination state (`claimableItems`, `planFrontier`) is **identical** with vs without `devloop:*`
   events present in the canonical log. Anchored in the foundry repo (which owns the fold); proves
   the doing-machine is unaffected by twin observations.
6. **Migration idempotency** — running the migration twice yields a **byte-identical** canonical log.
7. **Green gate** — the entire devloop test suite passes against the canonical log BEFORE the
   separate log is retired.

## 5. Reversibility

Shadow-then-collapse, never big-bang:
- The pre-migration canonical log is backed up; the migration is additive (append-only) + idempotent.
- The repoint is a config/path change; reverting it restores the two-log topology with no state loss.
- The default flips to the canonical log only after the suite is green; the old devloop log is
  **archived, not deleted**. Revert = repoint config back + (if needed) restore from archive.

## 6. Governance — ADR-245, zero kernel change

- **ADR-245** (status: ratified once charter-checker COHERENT) records the single-log collapse,
  supersedes ADR-241's homing clause re: the physical log, and ratifies retirement of devloop's
  separate log.
- **ADR-176 inclusion test — NOT triggered.** The kernel already provides the append-only-log
  *contract* (`DomainEventEnvelope`). Which physical file two PACKS read/write is pack-level
  persistence. Collapsing two pack log files into one introduces **no new kernel shape** and changes
  no kernel code. charter-checker runs regardless and must return COHERENT.

## 7. Scope boundaries (YAGNI)

- NO live event stream (HTTP/MCP) — file-based stays.
- NO physical repo merge in 1A (that is 1B, reassessed after 1A green).
- NO new kernel shapes; NO change to the kernel event-log contract.
- NO rewrite of devloop's inference — it is repointed, not reimplemented.

## 8. Open question carried forward

§12-style: once Slice 1A is green, does `planFrontier` subsume `claimableItems` (retire the queue
shadow)? That is **Stage 2** of the ladder (doing-side unification), not Phase B — noted, not decided
here.

## 9. Known follow-up — Slice 1B / hardening

**Concurrent-writer safety.** After Slice 1A, foundry's doing-machine and devloop's CLI both
`appendFileSync` to the same canonical `events.jsonl`. Per-call `appendFileSync` is effectively
atomic for the small writes each process makes (a single serialised JSON line), but **concurrent
multi-process appends are a new condition** not yet stress-tested in Slice 1A. In the current
usage pattern (foundry conductor and devloop CLI are rarely concurrent), this is low-risk. However,
it should be explicitly revisited and stress-tested in **Slice 1B or a dedicated hardening task**
before the canonical log is load-bearing for any high-frequency automated writer. Mitigation
options (file locking, a single writer process, an in-process queue) are deferred to that task.
