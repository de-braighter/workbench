# Foundry v1 Phase B — Canonical Log Collapse (Slice 1A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the foundry coordination log and the devloop observation log into ONE canonical event log (foundry's `events.jsonl`), so the doing-machine and the SDLC twin sit on one kernel spine — repoint, not rewrite; green-first; reversible; zero kernel change.

**Architecture:** Foundry's `events.jsonl` is THE canonical log. Devloop's `devloop:*` observation events append to it; devloop's readers read it directly; the `ingest-foundry` copy-step is deleted; devloop's historical own-events are migrated in (content-deduped, idempotent, backed-up). Each reader folds only its own namespace — foundry's `fold` already skips unknown types (`default: break`), and `readEnvelopes` validates only the shared envelope schema, so the namespaces coexist with no cross-coupling.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), vitest, JSONL files, `@de-braighter/substrate-contracts` `DomainEventEnvelope`.

## Global Constraints

- **Zero kernel change.** No edits to `@de-braighter/substrate-contracts` or `substrate-runtime`. Pack-level persistence only. (ADR-176 inclusion test NOT triggered.)
- **ESM imports use explicit `.js` extensions** (both repos are NodeNext ESM).
- **Test command:** `npx vitest run` from the repo root (`domains/foundry` or `domains/devloop`). Do NOT use `npm test` indirection if it shells to bash; `npx vitest run` is bash-free and works on this Windows box.
- **Determinism:** acid-test assertions use only DETERMINISTIC readers — `flowSummary`, `findingsSummary`, `qaBaseline`. NEVER `reliability` or `cycleTimePredictive` (unseeded `Math.random`).
- **Idempotency contract:** dedup is by CONTENT `dedupKey` (`eventType + canonical(payload)`, per `devloop/src/log.ts`), NOT `eventId` (devloop events carry no eventId). The migration reuses this.
- **Namespacing:** foundry events are `foundry:*`; devloop events are `devloop:*`. `packId` is `'foundry'` vs `'devloop'`.
- **Reversibility:** back up before any destructive op; archive (never delete) the retired log; the repoint is a revertible config change.
- **No `git add -A`.** Stage explicit paths only.
- **Branches:** foundry → `v1-phaseB-canonical-log`; devloop → `v1-phaseB-canonical-log`; specs → `foundry-v1-adr-245`; workbench docs already on `foundry-v1-phaseB-log-collapse`.

---

### Task 1: Foundry reader-tolerance regression test (foundry repo, TEST-ONLY)

Proves foundry's coordination state is immune to `devloop:*` events sharing the canonical log — the negative control, guarded in the repo that owns the behavior.

**Files:**
- Create: `domains/foundry/test/reader-tolerance.test.ts`
- (No production code change expected — `state.ts::fold` already has `default: break`.)

**Interfaces:**
- Consumes: foundry `readEnvelopes(logPath)` and the state fold (e.g. `fold(envelopes)` / `deriveState`) from `src/log.ts` + `src/state.ts` — confirm the exact exported fold/state fn name by reading `src/state.ts`.
- Produces: nothing downstream (regression guard).

- [ ] **Step 1: Write the failing/guard test**

```ts
// domains/foundry/test/reader-tolerance.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readEnvelopes } from '../src/log.js';
import { fold } from '../src/state.js'; // confirm actual export

function line(e: Record<string, unknown>) { return JSON.stringify(e); }

const foundryEvents = [
  /* author 4-5 realistic foundry:* envelopes: ProductRegistered.v1,
     WorkItemQueued.v1, ClaimAcquired.v1, MergeRecorded.v1 — full envelope
     shape: tenantPackId, packId:'foundry', aggregateType, aggregateId,
     eventType, payload, metadata:{actorRef}, occurredAt, eventId */
];
const devloopEvents = [
  /* author 2-3 devloop:* envelopes: VerdictRecorded.v1, FindingRecorded.v1 —
     packId:'devloop', NO eventId, source-truthful occurredAt */
];

function writeLog(events: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-tol-'));
  const p = join(dir, 'events.jsonl');
  writeFileSync(p, events.map(line).join('\n') + '\n');
  return p;
}

describe('foundry reader tolerates devloop:* events in the canonical log', () => {
  it('folds identical coordination state with vs without devloop events', () => {
    const mixed = writeLog([...foundryEvents, ...devloopEvents]);
    const clean = writeLog(foundryEvents);
    const sMixed = fold(readEnvelopes(mixed));
    const sClean = fold(readEnvelopes(clean));
    expect(sMixed).toEqual(sClean); // devloop events are inert to foundry
  });

  it('readEnvelopes does not throw on a mixed-namespace log', () => {
    const mixed = writeLog([...foundryEvents, ...devloopEvents]);
    expect(() => readEnvelopes(mixed)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd domains/foundry && npx vitest run test/reader-tolerance.test.ts`
Expected: PASS (tolerance already exists).

- [ ] **Step 3: Mutation check (prove the test BITES) — then REVERT**

Temporarily change `src/state.ts` `default: break;` → `default: throw new Error('unknown type');`. Re-run the test. Expected: the `.toEqual` test FAILS (devloop events now break the fold). **Revert the mutation immediately.** Re-run: PASS. This proves the guard detects intolerance.

- [ ] **Step 4: Commit**

```bash
git add domains/foundry/test/reader-tolerance.test.ts
git commit -m "test(foundry): guard reader tolerance of devloop:* events in canonical log"
```

---

### Task 2: Delete the `ingest-foundry` copy-step (devloop repo)

With one canonical log there is nothing to copy. `ingest-foundry` is a standalone subcommand (NOT `drain`); its handler only calls `ingestFoundry()`.

**Files:**
- Delete: `domains/devloop/src/ingest/foundry.ts`
- Delete: `domains/devloop/test/ingest-foundry.test.ts`
- Modify: `domains/devloop/src/cli.ts` — remove the `case 'ingest-foundry'` handler (~lines 249-255) and the `ingestFoundry` import.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (removal).

- [ ] **Step 1: Confirm no other callers**

Run: `cd domains/devloop && grep -rn "ingestFoundry\|ingest-foundry" src test` — expect only the cli.ts handler + import and the test file. If any OTHER caller exists, STOP and report (scope changed).

- [ ] **Step 2: Remove the module, test, and handler**

Delete `src/ingest/foundry.ts` and `test/ingest-foundry.test.ts`. In `src/cli.ts` remove the `import { ingestFoundry } from './ingest/foundry.js'` line and the entire `case 'ingest-foundry': { ... break; }` block. If the `ingest/` directory is now empty, remove it.

- [ ] **Step 3: Run the suite**

Run: `cd domains/devloop && npx vitest run`
Expected: PASS, with the ingest-foundry test no longer present and no dangling-import/type errors.

- [ ] **Step 4: Commit**

```bash
git add -u domains/devloop/src/cli.ts
git rm domains/devloop/src/ingest/foundry.ts domains/devloop/test/ingest-foundry.test.ts
git commit -m "refactor(devloop): delete ingest-foundry copy-step (one canonical log)"
```

---

### Task 3: Repoint devloop's `DEFAULT_LOG` to the canonical foundry log (devloop repo)

**Files:**
- Modify: `domains/devloop/src/log.ts` — the `DEFAULT_LOG` resolution (~line 14).
- Create: `domains/devloop/test/canonical-log-path.test.ts`

**Interfaces:**
- Consumes: `process.env['FOUNDRY_LOG']` (canonical-log override).
- Produces: `DEFAULT_LOG` now resolves to foundry's canonical `events.jsonl`. All `readEnvelopes()`/`append()` default callers (cli.ts) now read/write the canonical log.

- [ ] **Step 1: Write the failing test**

```ts
// domains/devloop/test/canonical-log-path.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

afterEach(() => { delete process.env['FOUNDRY_LOG']; });

describe('devloop DEFAULT_LOG points at the canonical foundry log', () => {
  it('honors FOUNDRY_LOG override and round-trips an append', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'devloop-canon-')), 'events.jsonl');
    process.env['FOUNDRY_LOG'] = p;
    const { append, readEnvelopes, DEFAULT_LOG } = await import('../src/log.js?canon=' + Date.now());
    expect(DEFAULT_LOG).toBe(p);
    append({ /* a minimal valid devloop:* envelope, packId:'devloop' */ } as any);
    expect(readEnvelopes()).toHaveLength(1);
    expect(readFileSync(p, 'utf8').trim().length).toBeGreaterThan(0);
  });

  it('defaults to the sibling foundry clone path when FOUNDRY_LOG is unset', async () => {
    const { DEFAULT_LOG } = await import('../src/log.js?nocanon=' + Date.now());
    expect(DEFAULT_LOG.replace(/\\\\/g, '/')).toMatch(/foundry\/data\/events\.jsonl$/);
  });
});
```
(If `DEFAULT_LOG` is a `const` evaluated at import, the test imports with a cache-busting query so env is read fresh. If devloop computes the path inside a function instead, adapt the test to that surface — read `src/log.ts` first.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd domains/devloop && npx vitest run test/canonical-log-path.test.ts`
Expected: FAIL (DEFAULT_LOG still points at devloop's own `data/events.jsonl`).

- [ ] **Step 3: Repoint `DEFAULT_LOG`**

In `src/log.ts`, change the default resolution to the canonical foundry path — the SAME resolution the old ingest used for its source:

```ts
// was: const DEFAULT_LOG = join(PKG_ROOT, 'data', 'events.jsonl');
const DEFAULT_LOG = process.env['FOUNDRY_LOG']
  ?? join(PKG_ROOT, '..', 'foundry', 'data', 'events.jsonl');
```
(Match the env-var name + relative path the deleted `ingest/foundry.ts` used as `DEFAULT_FOUNDRY_LOG`, so the canonical path is identical to what devloop already read.)

- [ ] **Step 4: Run the targeted test, then the full suite**

Run: `cd domains/devloop && npx vitest run test/canonical-log-path.test.ts` → PASS
Run: `cd domains/devloop && npx vitest run` → PASS (confirm no test that assumed the old default path regressed; fix any by passing an explicit tmp path).

- [ ] **Step 5: Commit**

```bash
git add -u domains/devloop/src/log.ts
git add domains/devloop/test/canonical-log-path.test.ts
git commit -m "feat(devloop): repoint DEFAULT_LOG to the canonical foundry log"
```

---

### Task 4: One-time migration of historical own-events into the canonical log (devloop repo)

Moves devloop's accumulated `devloop:*` own-events into the canonical log, content-deduped + idempotent + backed-up. Foundry events in the old devloop log are excluded by the `packId==='devloop'` filter (they already live in the canonical log natively).

**Files:**
- Create: `domains/devloop/src/migrate-to-canonical.ts` (exported fn) + a `migrate-to-canonical` CLI subcommand in `src/cli.ts`.
- Create: `domains/devloop/test/migrate-to-canonical.test.ts`

**Interfaces:**
- Consumes: `readEnvelopes(path)`, `append(env, path)`, `dedupKey(env)` from `src/log.ts` (confirm `dedupKey` export; if private, export it).
- Produces: `migrateOwnEventsToCanonical(oldLogPath: string, canonicalPath: string): { appended: number; skipped: number; backupPath: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// domains/devloop/test/migrate-to-canonical.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateOwnEventsToCanonical } from '../src/migrate-to-canonical.js';

const dl = (eventType: string, payload: object) => JSON.stringify({
  tenantPackId: 'devloop', packId: 'devloop', aggregateType: 'pr',
  aggregateId: JSON.stringify(payload), eventType, payload,
  metadata: { actorRef: 'test' }, occurredAt: '2026-06-01T00:00:00.000Z',
});
const fd = (eventType: string) => JSON.stringify({
  tenantPackId: 'foundry', packId: 'foundry', aggregateType: 'workItem',
  aggregateId: 'wi-1', eventType, payload: {}, metadata: { actorRef: 'x' },
  occurredAt: '2026-06-01T00:00:00.000Z', eventId: 'fixed-foundry-id-1',
});

function tmp(lines: string[]): string {
  const p = join(mkdtempSync(join(tmpdir(), 'mig-')), 'e.jsonl');
  writeFileSync(p, lines.join('\n') + '\n'); return p;
}

describe('migrateOwnEventsToCanonical', () => {
  it('appends only devloop:* own-events, idempotent by content', () => {
    const oldLog = tmp([dl('devloop:VerdictRecorded.v1', { id: 1 }),
                        dl('devloop:FindingRecorded.v1', { id: 2 }),
                        fd('foundry:MergeRecorded.v1')]);            // foundry copy → excluded
    const canon = tmp([fd('foundry:MergeRecorded.v1')]);            // already has the foundry event

    const r1 = migrateOwnEventsToCanonical(oldLog, canon);
    expect(r1.appended).toBe(2);                                   // 2 devloop events moved
    const after1 = readFileSync(canon, 'utf8');

    const r2 = migrateOwnEventsToCanonical(oldLog, canon);
    expect(r2.appended).toBe(0);                                   // idempotent
    expect(readFileSync(canon, 'utf8')).toBe(after1);              // byte-identical
    expect(readFileSync(r1.backupPath, 'utf8')).toContain('foundry:MergeRecorded'); // backup made
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd domains/devloop && npx vitest run test/migrate-to-canonical.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the migration**

```ts
// domains/devloop/src/migrate-to-canonical.ts
import { copyFileSync, existsSync } from 'node:fs';
import { readEnvelopes, append, dedupKey } from './log.js';

export function migrateOwnEventsToCanonical(oldLogPath: string, canonicalPath: string) {
  const backupPath = canonicalPath + '.pre-collapse.bak';
  if (existsSync(canonicalPath)) copyFileSync(canonicalPath, backupPath);
  const seen = new Set(readEnvelopes(canonicalPath).map(dedupKey));
  const own = readEnvelopes(oldLogPath).filter((e) => e.packId === 'devloop');
  let appended = 0, skipped = 0;
  for (const e of own) {
    const k = dedupKey(e);
    if (seen.has(k)) { skipped++; continue; }
    append(e, canonicalPath); seen.add(k); appended++;
  }
  return { appended, skipped, backupPath };
}
```
Add a thin `case 'migrate-to-canonical':` handler in `src/cli.ts` that calls it with `(oldLogArg, DEFAULT_LOG)` and prints the result. (`dedupKey` must be exported from `log.ts` — export it if private.)

- [ ] **Step 4: Run the test → PASS, then full suite**

Run: `cd domains/devloop && npx vitest run test/migrate-to-canonical.test.ts` → PASS
Run: `cd domains/devloop && npx vitest run` → PASS

- [ ] **Step 5: Commit**

```bash
git add domains/devloop/src/migrate-to-canonical.ts domains/devloop/test/migrate-to-canonical.test.ts
git add -u domains/devloop/src/cli.ts domains/devloop/src/log.ts
git commit -m "feat(devloop): idempotent one-time migration of own-events to canonical log"
```

---

### Task 5: The biting acid test — seam-killer (devloop repo)

The falsifier that BITES: proves devloop's posteriors are computed from `devloop:*` events living in the ONE canonical log, and that a cross-log seam (an event left behind) is detectable.

**Files:**
- Create: `domains/devloop/test/canonical-collapse.acid.test.ts`

**Interfaces:**
- Consumes: `readEnvelopes`, `flowSummary` (`src/inference/flow.ts`), `findingsSummary` (`src/inference/findings.ts`). Confirm exact signatures by reading those files (e.g. `flowSummary(events, now, productKey?)`, `findingsSummary(events, repo)`).

- [ ] **Step 1: Write the acid test**

```ts
// domains/devloop/test/canonical-collapse.acid.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { readEnvelopes } from '../src/log.js';
import { findingsSummary } from '../src/inference/findings.js';
import { flowSummary } from '../src/inference/flow.js';

// Independently-authored fixture: foundry coordination + devloop observation events.
const foundry = [ /* WorkItemQueued.v1, ClaimAcquired.v1, MergeRecorded.v1 for repo 'r#1' */ ];
const devloop = [ /* 3x devloop:FindingRecorded.v1 (verifier/severity) + PrOpened/PrMerged for 'r#1' */ ];

function writeLog(events: object[]): string {
  const p = join(mkdtempSync(join(tmpdir(), 'acid-')), 'events.jsonl');
  writeFileSync(p, events.map((e) => JSON.stringify(e)).join('\n') + '\n'); return p;
}

describe('canonical-log collapse — acid', () => {
  it('SEAM (bites): dropping ONE devloop event changes a deterministic posterior', () => {
    const full = readEnvelopes(writeLog([...foundry, ...devloop]));
    const minusOne = readEnvelopes(writeLog([...foundry, ...devloop.slice(1)]));
    const a = findingsSummary(full, 'r');
    const b = findingsSummary(minusOne, 'r');
    expect(a).not.toEqual(b); // the removed devloop event WAS consumed from the one log
  });

  it('NEGATIVE CONTROL: an irrelevant foundry coordination event leaves the posterior unchanged', () => {
    const base = readEnvelopes(writeLog([...foundry, ...devloop]));
    const plusNoise = readEnvelopes(writeLog([...foundry, /* extra foundry:ClaimReleased.v1 */, ...devloop]));
    expect(findingsSummary(plusNoise, 'r')).toEqual(findingsSummary(base, 'r'));
  });

  it('TWO-LOG EQUIVALENCE (replay): one canonical log == foundry-log + devloop-log union', () => {
    const canonical = readEnvelopes(writeLog([...foundry, ...devloop]));
    const split = readEnvelopes(writeLog(foundry)).concat(readEnvelopes(writeLog(devloop)));
    expect(flowSummary(canonical, new Date('2026-06-30T00:00:00Z')))
      .toEqual(flowSummary(split, new Date('2026-06-30T00:00:00Z')));
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd domains/devloop && npx vitest run test/canonical-collapse.acid.test.ts`
Expected: PASS on all three. If SEAM does not bite (a == b), the fixture's dropped event must be one `findingsSummary` actually consumes — fix the fixture so the dropped event materially affects the summary (this is the test EARNING its bite).

- [ ] **Step 3: Mutation verification (prove the SEAM test bites)**

Temporarily change the SEAM test's `minusOne` to use the FULL `devloop` array (no drop). Re-run. Expected: the `not.toEqual` assertion FAILS (a == b). Revert. This proves the test detects the seam, not noise.

- [ ] **Step 4: Commit**

```bash
git add domains/devloop/test/canonical-collapse.acid.test.ts
git commit -m "test(devloop): biting acid test for canonical-log collapse (seam + controls)"
```

---

### Task 6: Green gate + cutover runbook (devloop repo)

**Files:**
- Create: `domains/devloop/docs/canonical-log-cutover.md` (operational runbook).

- [ ] **Step 1: Full suite green**

Run: `cd domains/devloop && npx vitest run` → ALL PASS. Run: `cd domains/foundry && npx vitest run` → ALL PASS (Task 1 included).

- [ ] **Step 2: Write the cutover runbook**

Document the one-time operational cutover (executed by the orchestrator post-merge, NOT in CI):
1. Back up the real canonical log: `cp <foundry>/data/events.jsonl <foundry>/data/events.jsonl.pre-collapse.bak`.
2. Run `node` the `migrate-to-canonical` command with the real OLD devloop log path → appends devloop history into the canonical log.
3. Verify: `npx vitest run` green; `flow`/`findings`/`reconcile` commands produce non-empty, sane output against the canonical log.
4. Archive the old devloop log: rename `<devloop>/data/events.jsonl` → `events.jsonl.retired-2026-06-18` (DO NOT delete).
5. Rollback: restore the `.pre-collapse.bak` + un-repoint = two logs again.

- [ ] **Step 3: Commit**

```bash
git add domains/devloop/docs/canonical-log-cutover.md
git commit -m "docs(devloop): canonical-log cutover runbook"
```

---

### Task 7: ADR-245 — single canonical log (specs repo, designer-authored)

Drafted by a `substrate-architect` (or `designer`) subagent + adr-scaffolder discipline; reviewed by `charter-checker` (must return COHERENT) + `spec-auditor`. NOT a code-implementer task.

**Files:**
- Create: `layers/specs/adr/adr-245-foundry-canonical-log-collapse.md` (status `ratified` only after charter-checker COHERENT).
- Modify: `layers/specs/adr/adrs-by-tier.md` (+1 the relevant tier count) and any ADR index.

- [ ] **Step 1: Reserve ADR-245 atomically** (confirm 245 is free: `ls layers/specs/adr | grep adr-245` empty; 244 is latest).
- [ ] **Step 2: Author the ADR** — records the single canonical log; supersedes ADR-241 §3's split-log homing; ratifies devloop's separate-log retirement; states the ADR-176 inclusion test is NOT triggered (pack-level persistence; kernel append-only-log contract unchanged). Reference ADR-244 (Phase A), ADR-242 (derived substance), ADR-176.
- [ ] **Step 3: Validate** — `node tools/validators/frontmatter-schema.mjs layers/specs/adr/adr-245-*.md` (status ∈ {proposed, ratified, superseded}); spec-auditor clean.
- [ ] **Step 4: Commit** on branch `foundry-v1-adr-245`.

---

## Self-Review

**Spec coverage:** §1 problem → addressed by the whole collapse. §2 Slice 1A (one log, delete copy-step, reader tolerance, deterministic ids, occurredAt, migration, green-first) → Tasks 1-6. §2 Slice 1B → explicitly deferred (not a task). §3 namespacing + no-live-stream → Global Constraints + Task 3. §4 acid test (fixture, bit-stability, red-on-seam, 2 negative controls, idempotency, green gate) → Task 5 (seam + neg-control + equivalence) + Task 4 (idempotency) + Task 1 (foundry-side negative control) + Task 6 (green gate). §5 reversibility → Task 4 backup + Task 6 runbook. §6 ADR-245 zero-kernel → Task 7. §7 YAGNI boundaries → Global Constraints. §8 Stage-2 carry-forward → noted, no task. **No gaps.**

**Placeholder scan:** Fixture event arrays in Tasks 1 & 5 are marked `/* author ... */` — the implementer authors concrete envelopes from the real `events.ts` type literals (this is fixture authoring, intentionally implementer-filled against live schemas, not a hidden requirement). All commands, paths, signatures, and the migration code are concrete.

**Type consistency:** `migrateOwnEventsToCanonical(oldLogPath, canonicalPath)` used identically in Task 4 impl + test. `dedupKey`, `readEnvelopes`, `append` referenced consistently. `flowSummary`/`findingsSummary` flagged "confirm signature by reading source" — correct (recon gave `flowSummary(events, now, productKey?)`, `findingsSummary(events, repo)`).

**Execution note:** Tasks 1 (foundry) and 7 (specs) are independent repos and may run in parallel with the devloop chain (Tasks 2→3→4→5→6, sequential — they share `cli.ts`/`log.ts`). Four PRs result: foundry, devloop, specs, workbench(docs).
