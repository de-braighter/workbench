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
4. **Deterministic event identity.** Devloop's own events mint stable `eventId`s
   (`uuidv5` over each event's natural key, mirroring foundry's writer) so dedup and re-runnable
   migration are idempotent. Historical events keep their already-persisted ids.
5. **Source-truthful `occurredAt`.** Devloop's own events carry source time (GitHub PR
   `createdAt`/`mergedAt`, verdict time) — already true for backfilled events; the ingest-time drift
   problem **disappears** with the copy-step.
6. **One-time migration.** Append devloop's historical **own** events (those NOT already in the
   canonical log) into the canonical log, ordered by `occurredAt`, deduped by `eventId`, idempotent,
   with the pre-migration canonical log backed up. Devloop's historical *ingested* foundry events are
   skipped (already present).
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
- **No live stream.** File-based remains; a long-running reader re-reads the file (unchanged from
  today). An HTTP/MCP event stream is explicitly **out of scope** (YAGNI; note as future v1.1).

## 4. Acid test — must BITE

Per the arc's falsifier discipline (independently-authored fixtures + mutation that flips RED +
negative control + whole-branch review):

1. **Independently-authored fixture** — a hand-built canonical log with interleaved `foundry:*` +
   `devloop:*` events and *known* expected posteriors (NOT produced by the code under test).
2. **Bit-stability** — folding the canonical log reproduces devloop's posteriors (cycle-time median,
   calibration score, reliability) **bit-for-bit** vs the pre-collapse two-log computation for the
   same logical events (seeded PRNG → replay-deterministic).
3. **Red-on-seam mutation (THE seam-detector)** — remove ONE `devloop:*` observation event from the
   canonical log (simulating "it stayed behind in the old separate log"). A posterior changes; the
   equality assertion goes **RED**. If any event is not in the one canonical log, this test fails.
4. **Negative control A** — appending an unrelated/no-op event type does NOT move any posterior
   (the test is not trivially sensitive to every line).
5. **Negative control B (foundry side)** — foundry's coordination state (`claimableItems`,
   `planFrontier`) is **identical** with vs without `devloop:*` events present in the canonical log
   (reader tolerance proven; doing-machine unaffected by twin observations).
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
