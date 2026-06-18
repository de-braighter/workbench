# Foundry v1 P4 — Concurrent-Writer Safety on the Canonical Log

> Introduces a per-append OS advisory lock keyed on the log path, acquired by BOTH
> `domains/foundry` and `domains/devloop` before writing a line, so that concurrent
> cross-process writers cannot interleave mid-line and produce a torn JSON record that
> fails replay. **Zero kernel change; write-discipline on two pack-local `append()` calls.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`src/store-lock.ts`, `src/log.ts`).
  `domains/devloop` (new `src/store-lock.ts`, `src/log.ts`).
  `layers/specs` (ADR-253, status proposed).
- **Predecessors:** ADR-245 (canonical-log collapse — created the shared-writer
  situation), ADR-176 (kernel minimality inclusion test), ADR-250 (multi-target
  compiler — Stage 5).

---

## 1. Problem — two unlocked cross-process writers share one file

**Recon (verified against source):**

- Both repos resolve `DEFAULT_LOG` to the same path: foundry via `FOUNDRY_LOG ??
  join(DEFAULT_DATA_DIR, 'events.jsonl')` (`src/log.ts:14`); devloop via `FOUNDRY_LOG
  ?? join(PKG_ROOT, '..', 'foundry', 'data', 'events.jsonl')` (`src/log.ts:14`).
  ADR-245 made this intentional — one shared canonical log.
- foundry `append()` (`src/log.ts:19-23`): validate → `mkdirSync` parent → `appendFileSync`.
- devloop `append()` (`src/log.ts:17-21`): validate → `mkdirSync` parent → `appendFileSync`.
  Separate implementations; neither holds a lock before writing.
- foundry's `withStoreLock(dataDir, fn)` (`src/store-lock.ts:102-130`) is a sound
  advisory mutex keyed on `join(dataDir, '.lock')`. It serializes foundry's own
  logical transactions (read state → mutate → append ≥1 lines) so the store is
  consistent at transaction granularity. It does NOT guard individual line-writes
  against a second process writing between them.
- devloop has zero locking of any kind.

**Consequence:** a foundry MCP/conductor session and a devloop CLI ritual running
simultaneously against the same log file can interleave `appendFileSync` calls
mid-line. Node's `appendFileSync` is synchronous within one process (single-threaded),
so intra-process ordering is safe. Cross-process is NOT: the OS may schedule two
`write(2)` syscalls so their byte ranges overlap inside the kernel buffer, producing a
single line that is neither record A nor record B. `readEnvelopes` calls
`DomainEventEnvelopeSchema.parse(JSON.parse(line))` and throws on any malformed line
("fail loud", `src/log.ts:35`). A single torn line halts all replay.

**Why this is acute now:** P3 (foundry self-event-sourcing) will cause foundry to emit
events about its own operations, raising the frequency of concurrent appends to the
shared log. P4 must land before P3 is built.

---

## 2. Decision — path-keyed log lock wrapping every append in both repos

### Lock convention (pinned — deviation breaks cross-process serialization)

The lock directory for a log at path `logPath` is always:

```
lockDir = logPath + '.lock'
```

Examples:
- `/x/data/events.jsonl` → `/x/data/events.jsonl.lock`
- `D:\dev\foundry\data\events.jsonl` → `D:\dev\foundry\data\events.jsonl.lock`

Both repos MUST derive this identically. A unit assertion in each repo's test suite
pins the literal (see §4). The lock is a transient directory (not a file) acquired by
atomic `mkdirSync` (EEXIST = held), same protocol as foundry's existing
`withStoreLock`. It exists only during the ~microsecond span of a single `appendFileSync`
call and is removed immediately after.

### What changes in `domains/foundry`

**R1 — Refactor `src/store-lock.ts`:** extract a path-keyed core function so the
dataDir lock and the new log lock share implementation:

```ts
/** Core: run `fn` while holding the lock directory at `lockDir`. */
export function withLockDir<T>(lockDir: string, fn: () => T, opts?: LockOptions): T;

/** Existing API (unchanged callers): dataDir-keyed store lock. */
export function withStoreLock<T>(dataDir: string, fn: () => T, opts?: LockOptions): T {
  return withLockDir(join(dataDir, '.lock'), fn, opts);
}

/** Log-path-keyed append lock. Hold time = one appendFileSync call (<< 1ms). */
export function withLogLock<T>(logPath: string, fn: () => T, opts?: LockOptions): T {
  return withLockDir(logPath + '.lock', fn, opts);
}

/** Derives the log lock dir from a log path. Exported for the convention pin test. */
export function logLockDir(logPath: string): string {
  return logPath + '.lock';
}
```

All acquire/spin/stale-takeover logic moves into `withLockDir`; `withStoreLock` and
`withLogLock` are thin delegates. No behaviour change for existing callers of
`withStoreLock`.

**R2 — Wrap `append()` in `src/log.ts`:**

```ts
import { withLogLock } from './store-lock.js';

export function append(env: DomainEventEnvelope, logPath: string = DEFAULT_LOG): void {
  const valid = DomainEventEnvelopeSchema.parse({ ...env, eventId: env.eventId ?? randomUUID() });
  mkdirSync(dirname(logPath), { recursive: true });
  withLogLock(logPath, () => {
    appendFileSync(logPath, JSON.stringify(valid) + '\n');
  });
}
```

The lock wraps only the `appendFileSync` call. Schema validation and dir-creation
happen outside the lock (idempotent and non-conflicting).

### What changes in `domains/devloop`

**R3 — Add `src/store-lock.ts`:** devloop cannot import foundry's package (separate
clone, no published dependency). It replicates the identical mkdir-EEXIST protocol
with the identical `logPath + '.lock'` derivation. The implementation is the subset
needed: `withLockDir` + `withLogLock` + `logLockDir`. The acquire/spin/stale-takeover
logic is copied verbatim. (Duplication is accepted here; promotion to a shared
published package is the future consolidation if a third writer appears — demand-driven
per ADR-176. P8, devloop repo retirement, would eliminate the cross-writer case
entirely.)

**R4 — Wrap `append()` in devloop's `src/log.ts`:**

```ts
import { withLogLock } from './store-lock.js';

export function append(env: DomainEventEnvelope, logPath: string = DEFAULT_LOG): void {
  const valid = DomainEventEnvelopeSchema.parse(env);
  mkdirSync(dirname(logPath), { recursive: true });
  withLogLock(logPath, () => {
    appendFileSync(logPath, JSON.stringify(valid) + '\n');
  });
}
```

Same pattern; `appendUnique` calls `append`, so it inherits the lock automatically.

### Complementarity with existing dataDir lock

The existing `withStoreLock(dataDir, fn)` in foundry STAYS. It serializes multi-append
logical transactions (read → mutate → append N lines) so the store is consistent from
foundry's perspective. The new log lock is the line-level cross-writer guard. Nesting
is always **dataDir-outer / log-inner** (a foundry transaction holds the store lock,
then each `append()` call within it takes and releases the log lock). No deadlock is
possible: a devloop append takes only the log lock, never the store lock.

Interleaving a devloop append between two consecutive foundry-transaction appends is
fine — the log is append-only and readers sort/dedup by eventId/occurredAt. Only a
torn LINE would corrupt replay; whole-line interleaving is correct.

---

## 3. Architecture

```
foundry session (MCP/conductor)          devloop CLI (ritual)
  withStoreLock(dataDir, () => {           append(env)
    readEnvelopes(logPath)                   mkdirSync(parent)
    // compute mutation                       withLogLock(logPath, () =>
    append(env1, logPath)                       appendFileSync(logPath, line)
      withLogLock(logPath, () =>             )
        appendFileSync(logPath, line1)
      )
    append(env2, logPath)
      withLogLock(logPath, () =>
        appendFileSync(logPath, line2)
      )
  })

Lock dir (transient, ~microsecond hold):
  /x/data/events.jsonl.lock/
    meta.json  { pid, ts, nonce }
```

The log lock is acquired and released per-line. The store lock is held across the
whole logical transaction. Two different granularities; no hierarchy conflict.

---

## 4. Acid test — must BITE (cross-process, large payloads)

### Positive: locked appends produce zero torn lines

```ts
// spawn K child processes; each appends M events via the PRODUCTION locked append
// payload size: 32–64 KB strings (force multi-write to make tearing observable)
// after all children exit:
// (a) every line parses as valid JSON — zero torn lines
// (b) line count === K * M — zero lost writes
// (c) fold(readEnvelopes(logPath)) is deterministic — bit-stable across two runs
const K = 8, M = 50, PAYLOAD_SIZE = 48 * 1024;
```

Each child is a small `tsx` script that imports the locked `append` from its own repo
and writes M envelopes. The parent waits for all children via `Promise.all` on
`child_process.spawn` exit codes, then asserts (a)–(c).

### Negative control: unlocked appends DO produce torn lines (the test bites)

A second stress run where each child script calls raw `appendFileSync` WITHOUT the log
lock, with the same K / M / payload. Assert that the result either:
- (a) contains at least one line that fails `JSON.parse`, OR
- (b) has a line count != K * M.

This proves the lock is necessary and that the positive test would catch a regression
if the lock were removed. **Windows determinism note:** `appendFileSync` on Windows
issues a `WriteFile` syscall; at 48 KB, a single write may exceed the pipe buffer
and be split across multiple kernel write operations, making tearing more reliable.
If empirically the raw stress proves non-deterministically clean (small writes happen
to be atomic on the test machine), document the payload size and K/M that produces
consistent tearing, and gate the negative control as a `@flaky`-tagged stress test
rather than a CI unit test. The positive control (locked path) is always a CI unit
test regardless.

### Convention pin: lock-dir derivation must be a pinned literal (both repos)

```ts
// foundry: src/store-lock.spec.ts
import { logLockDir } from './store-lock.js';
it('lock-dir derivation matches pinned convention', () => {
  expect(logLockDir('/x/events.jsonl')).toBe('/x/events.jsonl.lock');
  expect(logLockDir('D:\\dev\\data\\events.jsonl')).toBe('D:\\dev\\data\\events.jsonl.lock');
});

// devloop: src/store-lock.spec.ts — identical assertion
```

Both tests must be present and pass. This is the cross-process contract: if the two
repos ever drift in their derivation they will each acquire a different lock directory
and the cross-writer guard becomes a no-op.

---

## 5. ADR-176 analysis — NOT triggered

P4 is a write-discipline on two pack-local `append()` functions:

- (a) The log file is foundry/devloop pack infrastructure, not a kernel contract.
  `@de-braighter/substrate-contracts` and `@de-braighter/substrate-runtime` have no
  opinion on how a pack's JSONL log is written.
- (b) The mkdir-EEXIST lock protocol is replicated in devloop rather than promoted to
  a shared kernel primitive because only two writers exist and the risk of a third is
  speculative. ADR-176's demand-driven promotion rule applies: promote only on
  demonstrated multi-pack need.
- No new event types; no new kernel contracts; no schema migrations.

ZERO changes to `@de-braighter/substrate-contracts` or `@de-braighter/substrate-runtime`.
Charter-checker must confirm COHERENT.

---

## 6. Reversibility

The lock wraps `appendFileSync`; removing it reverts to today's unlocked status quo.
No log format change: the `.lock` directory is transient and never written to the log.
Old logs replay identically before and after P4. The `.lock` dir is cleaned up in the
`finally` block on every normal and exceptional exit; a process crash leaves a stale
dir that the next waiter's stale-takeover removes (same recovery path as the existing
`withStoreLock`).

---

## 7. Slice scope

- **foundry:** refactor `src/store-lock.ts` (extract `withLockDir`, add `withLogLock`,
  `logLockDir`); update `src/log.ts` to wrap `appendFileSync` in `withLogLock`.
  Add `src/store-lock.spec.ts` convention pin. Add cross-process stress test.
- **devloop:** new `src/store-lock.ts` (identical protocol, `withLockDir` + `withLogLock`
  + `logLockDir`); update `src/log.ts`. Add `src/store-lock.spec.ts` convention pin.
  Add (or share) cross-process stress test.
- **specs:** ADR-253 (proposed) — codifies the `<logPath>.lock` convention as the
  cross-writer serialization contract.

P4 must be merged before P3 (foundry self-event-sourcing) is built, because P3 will
increase the rate of concurrent foundry appends and the P4 gap will become immediately
observable.

---

## 8. Deferred

- **Shared published lock package** — if a third writer appears (e.g. a future devloop
  sub-process or a conservation pack that shares the log), promote the mkdir-EEXIST
  protocol to `@de-braighter/std` or a new `@de-braighter/store-lock` package. ADR-176
  demand-driven; do not promote speculatively.
- **P8 devloop repo retirement** — would collapse both writers into one process and
  eliminate the cross-writer case entirely. P4 becomes dead code at that point; the
  per-append lock overhead is negligible and the safety is worth keeping regardless.
- **Inbox/verdict-inbox locking** — devloop's `verdict-inbox.jsonl` is written by the
  SubagentStop hook and drained by the CLI. That file has a different write/drain
  lifecycle (the hook clears it; the CLI does not). Locking that path is a separate
  assessment; it is NOT in scope for P4.
