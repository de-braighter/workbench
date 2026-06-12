# F6 — Foundry Twin Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Devloop ingests the foundry control plane's event log (dedup by `eventId`), derives queue/claim-flow + end-to-end lead-time readouts, and renders an advisory per-repo wave-composition readout from finding precision.

**Architecture:** Three new units in `domains/devloop` — `src/ingest/foundry.ts` (pull-ingest, peer of `ingest/github.ts`), `src/inference/flow.ts` (pure fold + cross-log prRef join), `src/inference/wave.ts` (advisory over the existing `findingsSummary`) — wired into the flat CLI switch and the `ritual:post-merge` chain. One doc touch in the workbench repo (`workflows/verifier-wave.md`). The foundry log **file** is the contract; devloop never imports foundry code.

**Spec:** `docs/superpowers/specs/2026-06-12-foundry-f6-twin-integration-design.md` (founder-approved).

**Tech Stack:** TypeScript ESM (`.js` import suffixes), zod via `@de-braighter/substrate-contracts/events`, vitest 2 (`test/*.test.ts`), tsx CLI. npm (flat node_modules), NOT pnpm.

**Repos & branches:** Tasks 1–4 in `domains/devloop` on branch `feat/f6-twin-integration` (own PR). Task 5 in the workbench repo on branch `docs/f6-twin-integration` (spec + this plan + verifier-wave.md, own PR). Never `git add -A` in the workbench (untracked WIP).

**Conventions that will bite:**
- Dedup for foundry events is by **`eventId`** (foundry mints it at source for exactly this). Do NOT reuse `log.ts dedupKey`/`appendUnique` — that is content-identity and its doc comment forbids reuse where distinct events could share a payload (heartbeats do).
- Foundry envelopes append **verbatim** — original `tenantPackId`/`packId: 'foundry'`/`actorRef`/`occurredAt` preserved. Existing devloop folds select by `eventType` so `foundry:*` events are inert in them.
- Only release outcome `done` is terminal; `blocked`/`abandoned` re-queue the item (F1 semantics).
- Live `prRef` format is full `owner/repo#pr` (e.g. `de-braighter/agri-ecosystem-twin#1`); parse with the existing `parsePrRef` from `src/events.ts`.

---

### Task 1: Foundry ingest (`ingest-foundry`)

**Files:**
- Create: `domains/devloop/src/ingest/foundry.ts`
- Create: `domains/devloop/test/ingest-foundry.test.ts`
- Modify: `domains/devloop/src/cli.ts` (one import + one switch case)

- [ ] **Step 1: Branch off main in `domains/devloop`**

```bash
cd domains/devloop && git checkout main && git pull && git checkout -b feat/f6-twin-integration
```

- [ ] **Step 2: Write the failing test**

Create `domains/devloop/test/ingest-foundry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ingestFoundry } from '../src/ingest/foundry.js';
import { readEnvelopes, append } from '../src/log.js';
import { prMerged } from '../src/events.js';

// Foundry-shaped fixture envelopes. The shared schema is the contract — we do NOT
// import foundry code; tenant/aggregate ids mirror the live foundry log.
const F_TENANT = 'f0d40000-0000-5000-8000-0000000000f1';
const AGG = '92f1bfce-c1b4-5f67-bb59-fe870bb5a62b';
const fEnv = (eventId: string, eventType: string, payload: object, occurredAt = '2026-06-10T12:00:00.000Z') => ({
  eventId, tenantPackId: F_TENANT, packId: 'foundry', aggregateType: 'WorkItem', aggregateId: AGG,
  eventType, payload, metadata: { actorRef: 'foundry:queue' }, occurredAt,
});
const tmp = () => mkdtempSync(join(tmpdir(), 'f6-ingest-'));

describe('ingestFoundry', () => {
  it('appends foundry events verbatim and is idempotent by eventId', () => {
    const dir = tmp();
    const src = join(dir, 'foundry.jsonl');
    const log = join(dir, 'events.jsonl');
    writeFileSync(src, [
      JSON.stringify(fEnv('00000000-0000-4000-8000-000000000001', 'foundry:WorkItemQueued.v1',
        { itemId: 'p/E1', productKey: 'p', title: 'scaffold', scope: { repo: 'o/r' }, dependsOn: [], qualityObligations: [] })),
      JSON.stringify(fEnv('00000000-0000-4000-8000-000000000002', 'foundry:ClaimAcquired.v1',
        { claimId: 'c1', itemId: 'p/E1', sessionId: 's1', ttlMinutes: 240 })),
    ].join('\n') + '\n');
    const first = ingestFoundry(src, log);
    expect(first).toMatchObject({ appended: 2, skipped: 0, sourceMissing: false });
    const second = ingestFoundry(src, log);
    expect(second).toMatchObject({ appended: 0, skipped: 2 });
    const stored = readEnvelopes(log);
    expect(stored).toHaveLength(2);
    // verbatim provenance — nothing re-stamped
    expect(stored[0]).toMatchObject({ packId: 'foundry', tenantPackId: F_TENANT, eventId: '00000000-0000-4000-8000-000000000001' });
    expect(stored[0]?.metadata).toMatchObject({ actorRef: 'foundry:queue' });
  });

  it('ignores devloop-pack events when seeding the dedup set', () => {
    const dir = tmp();
    const src = join(dir, 'foundry.jsonl');
    const log = join(dir, 'events.jsonl');
    append(prMerged({ repo: 'o/r', pr: 1, title: 't', cycleHours: 1, ts: '2026-06-10T00:00:00Z' }), log);
    writeFileSync(src, JSON.stringify(fEnv('00000000-0000-4000-8000-000000000003', 'foundry:ClaimHeartbeat.v1', { claimId: 'c1', itemId: 'p/E1' })) + '\n');
    expect(ingestFoundry(src, log).appended).toBe(1);
    expect(readEnvelopes(log)).toHaveLength(2);
  });

  it('no-ops with sourceMissing when the foundry log is absent', () => {
    const dir = tmp();
    const r = ingestFoundry(join(dir, 'nope.jsonl'), join(dir, 'events.jsonl'));
    expect(r).toMatchObject({ appended: 0, skipped: 0, sourceMissing: true });
    expect(r.sourcePath).toMatch(/nope\.jsonl$/);
  });

  it('fails loud on a corrupt source line, with its line number', () => {
    const dir = tmp();
    const src = join(dir, 'foundry.jsonl');
    writeFileSync(src, '{"not":"an envelope"}\n');
    expect(() => ingestFoundry(src, join(dir, 'events.jsonl'))).toThrow(/corrupt foundry log line 1/);
  });

  it('rejects a source event without an eventId (contract violation)', () => {
    const dir = tmp();
    const src = join(dir, 'foundry.jsonl');
    const { eventId: _drop, ...noId } = fEnv('00000000-0000-4000-8000-000000000004', 'foundry:ClaimHeartbeat.v1', { claimId: 'c1', itemId: 'p/E1' });
    writeFileSync(src, JSON.stringify(noId) + '\n');
    expect(() => ingestFoundry(src, join(dir, 'events.jsonl'))).toThrow(/without eventId/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd domains/devloop && npx vitest run test/ingest-foundry.test.ts
```

Expected: FAIL — `Cannot find module '../src/ingest/foundry.js'`.

- [ ] **Step 4: Write the implementation**

Create `domains/devloop/src/ingest/foundry.ts`:

```typescript
// F6 ingest — pull the foundry control plane's append-only log into the twin's log.
// The log FILE is the integration contract (devloop never imports foundry code).
// Dedup is by `eventId` — foundry mints it at source as "the stable dedup/reference
// key for downstream consumers (devloop F6)". Do NOT use log.ts dedupKey here: that
// is content-identity, and distinct foundry events (heartbeats) can share a payload.
// Envelopes append VERBATIM — tenantPackId/packId/actorRef/occurredAt are provenance.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainEventEnvelopeSchema } from '@de-braighter/substrate-contracts/events';
import { append, readEnvelopes, DEFAULT_LOG } from '../log.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Sibling clone in the cluster; FOUNDRY_LOG overrides (same pattern as DEVLOOP_LOG). */
export const DEFAULT_FOUNDRY_LOG =
  process.env['FOUNDRY_LOG'] ?? join(PKG_ROOT, '..', 'foundry', 'data', 'events.jsonl');

export const FOUNDRY_PACK_ID = 'foundry';

export interface FoundryIngestResult {
  appended: number;
  skipped: number;
  sourceMissing: boolean;
  sourcePath: string;
}

/** Idempotent batch ingest: a second run over the same source appends 0. A missing
 *  source is a no-op (the ritual must never block on a sibling clone being absent);
 *  a corrupt line or a missing eventId fails loud (source contract violation). */
export function ingestFoundry(
  sourcePath: string = DEFAULT_FOUNDRY_LOG,
  logPath: string = DEFAULT_LOG,
): FoundryIngestResult {
  if (!existsSync(sourcePath)) return { appended: 0, skipped: 0, sourceMissing: true, sourcePath };
  const source = readFileSync(sourcePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      try {
        return DomainEventEnvelopeSchema.parse(JSON.parse(line));
      } catch (e) {
        throw new Error(`corrupt foundry log line ${i + 1}: ${(e as Error).message}`);
      }
    });
  const seen = new Set(
    readEnvelopes(logPath)
      .filter((e) => e.packId === FOUNDRY_PACK_ID)
      .map((e) => e.eventId),
  );
  let appended = 0;
  let skipped = 0;
  for (const env of source) {
    if (!env.eventId) throw new Error(`foundry event without eventId (${env.eventType}) — source contract violation`);
    if (seen.has(env.eventId)) { skipped++; continue; }
    seen.add(env.eventId);
    append(env, logPath);
    appended++;
  }
  return { appended, skipped, sourceMissing: false, sourcePath };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd domains/devloop && npx vitest run test/ingest-foundry.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Wire the CLI case**

In `domains/devloop/src/cli.ts`, add to the import block (after the `ingest/github.js` import line):

```typescript
import { ingestFoundry } from './ingest/foundry.js';
```

Add a switch case (next to `case 'backfill':`):

```typescript
  case 'ingest-foundry': {
    const r = ingestFoundry();
    console.log(r.sourceMissing
      ? `foundry log not found at ${r.sourcePath} — skipped (nothing ingested)`
      : `ingested ${r.appended} foundry event(s) (${r.skipped} already present) -> ${DEFAULT_LOG}`);
    break;
  }
```

- [ ] **Step 7: Smoke-run against the real foundry log, then typecheck**

```bash
cd domains/devloop && npm run dev -- ingest-foundry && npm run typecheck
```

Expected: `ingested N foundry event(s) (0 already present) -> …data/events.jsonl` with N > 0 (the live agri run produced real events), then a clean typecheck. Run it twice — the second run must say `ingested 0 foundry event(s) (N already present)`.

- [ ] **Step 8: Commit**

```bash
cd domains/devloop && git add src/ingest/foundry.ts test/ingest-foundry.test.ts src/cli.ts && git commit -m "feat(f6): ingest-foundry — pull the foundry event log, dedup by eventId"
```

---

### Task 2: Flow readout fold + cross-log lead-time join

**Files:**
- Create: `domains/devloop/src/inference/flow.ts`
- Create: `domains/devloop/test/flow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `domains/devloop/test/flow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DomainEventEnvelopeSchema, type DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { flowSummary, F_EVENT } from '../src/inference/flow.js';
import { prOpened, prMerged } from '../src/events.js';

const F_TENANT = 'f0d40000-0000-5000-8000-0000000000f1';
const AGG = '92f1bfce-c1b4-5f67-bb59-fe870bb5a62b';
const fEnv = (eventType: string, payload: object, occurredAt: string): DomainEventEnvelope =>
  DomainEventEnvelopeSchema.parse({
    tenantPackId: F_TENANT, packId: 'foundry', aggregateType: 'WorkItem', aggregateId: AGG,
    eventType, payload, metadata: { actorRef: 'foundry:queue' }, occurredAt,
  });

const queued = (itemId: string, productKey: string, at: string) =>
  fEnv(F_EVENT.ITEM_QUEUED, { itemId, productKey, title: itemId }, at);
const claim = (itemId: string, claimId: string, at: string, ttlMinutes = 240) =>
  fEnv(F_EVENT.CLAIM_ACQUIRED, { claimId, itemId, sessionId: 's1', ttlMinutes }, at);
const release = (itemId: string, claimId: string, outcome: string, at: string, prRef?: string) =>
  fEnv(F_EVENT.CLAIM_RELEASED, { claimId, itemId, outcome, ...(prRef ? { prRef } : {}) }, at);

const NOW = new Date('2026-06-12T12:00:00Z');

describe('flowSummary', () => {
  it('folds the happy ladder and joins prRef to the merged PR', () => {
    const events = [
      queued('p/E1', 'p', '2026-06-10T00:00:00Z'),
      claim('p/E1', 'c1', '2026-06-10T02:00:00Z'),
      release('p/E1', 'c1', 'done', '2026-06-10T06:00:00Z', 'o/r#1'),
      prOpened({ repo: 'o/r', pr: 1, title: 't', ts: '2026-06-10T05:00:00Z' }),
      prMerged({ repo: 'o/r', pr: 1, title: 't', cycleHours: 1, ts: '2026-06-10T08:00:00Z' }),
    ];
    const [p] = flowSummary(events, NOW);
    expect(p).toMatchObject({ productKey: 'p', done: 1, queued: 0, inFlight: 0, stale: 0 });
    const [i] = p!.items;
    expect(i?.state).toBe('done');
    expect(i?.queueHours).toBeCloseTo(2);   // queued 00:00 -> claimed 02:00
    expect(i?.activeHours).toBeCloseTo(4);  // claimed 02:00 -> released 06:00
    expect(i?.lead).toMatchObject({ prRef: 'o/r#1', repo: 'o/r', pr: 1 });
    expect(i?.lead?.queuedToMergedHours).toBeCloseTo(8); // queued 00:00 -> merged 08:00
  });

  it('re-queues on abandoned release — only done is terminal (F1 semantics)', () => {
    const events = [
      queued('p/E1', 'p', '2026-06-10T00:00:00Z'),
      claim('p/E1', 'c1', '2026-06-10T01:00:00Z'),
      release('p/E1', 'c1', 'abandoned', '2026-06-10T02:00:00Z'),
    ];
    const [p] = flowSummary(events, NOW);
    expect(p!.items[0]).toMatchObject({ state: 'queued', requeues: 1 });
    expect(p!.abandonedReleases).toBe(1);
  });

  it('flags an unreleased claim past its TTL as stale', () => {
    const events = [
      queued('p/E1', 'p', '2026-06-12T00:00:00Z'),
      claim('p/E1', 'c1', '2026-06-12T01:00:00Z', 60), // 60min TTL, NOW is 12:00
    ];
    const [p] = flowSummary(events, NOW);
    expect(p!.items[0]?.state).toBe('stale');
    expect(p!.stale).toBe(1);
  });

  it('keeps an unreleased claim inside its TTL as in-flight', () => {
    const events = [
      queued('p/E1', 'p', '2026-06-12T00:00:00Z'),
      claim('p/E1', 'c1', '2026-06-12T11:30:00Z', 240),
    ];
    const [p] = flowSummary(events, NOW);
    expect(p!.items[0]?.state).toBe('claimed');
    expect(p!.inFlight).toBe(1);
  });

  it('reports an unjoined lead when the PR is not in the twin log', () => {
    const events = [
      queued('p/E1', 'p', '2026-06-10T00:00:00Z'),
      claim('p/E1', 'c1', '2026-06-10T01:00:00Z'),
      release('p/E1', 'c1', 'done', '2026-06-10T02:00:00Z', 'o/r#9'),
    ];
    const [p] = flowSummary(events, NOW);
    expect(p!.items[0]?.lead).toMatchObject({ prRef: 'o/r#9', repo: 'o/r', pr: 9 });
    expect(p!.items[0]?.lead?.mergedAt).toBeUndefined();
    expect(p!.items[0]?.lead?.queuedToMergedHours).toBeUndefined();
  });

  it('filters by productKey and otherwise summarizes all products', () => {
    const events = [
      queued('a/E1', 'a', '2026-06-10T00:00:00Z'),
      queued('b/E1', 'b', '2026-06-10T00:00:00Z'),
    ];
    expect(flowSummary(events, NOW)).toHaveLength(2);
    const only = flowSummary(events, NOW, 'a');
    expect(only).toHaveLength(1);
    expect(only[0]?.productKey).toBe('a');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd domains/devloop && npx vitest run test/flow.test.ts
```

Expected: FAIL — `Cannot find module '../src/inference/flow.js'`.

- [ ] **Step 3: Write the implementation**

Create `domains/devloop/src/inference/flow.ts`:

```typescript
// F6 flow readout — fold the foundry control plane's ingested exhaust (foundry:*
// events, see ingest/foundry.ts) into per-item ladders + per-product summaries, and
// join released items' prRef onto devloop's own PR events for end-to-end lead time.
// Pure — caller supplies events + now (stale detection is a time comparison).
// Payload shapes below MIRROR domains/foundry/src/events.ts; the log file is the
// contract — devloop never imports foundry code.
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { ofType } from '../log.js';
import { EVENT, parsePrRef } from '../events.js';

export const F_EVENT = {
  ITEM_QUEUED: 'foundry:WorkItemQueued.v1',
  CLAIM_ACQUIRED: 'foundry:ClaimAcquired.v1',
  CLAIM_RELEASED: 'foundry:ClaimReleased.v1',
} as const;

export type FoundryOutcome = 'done' | 'blocked' | 'abandoned';
interface QueuedPayload { itemId: string; productKey: string; title: string; }
interface AcquiredPayload { claimId: string; itemId: string; sessionId: string; ttlMinutes: number; }
interface ReleasedPayload { claimId: string; itemId: string; outcome: FoundryOutcome; prRef?: string; }

export interface ClaimSpan {
  claimId: string; sessionId: string; acquiredAt: string; ttlMinutes: number;
  releasedAt?: string; outcome?: FoundryOutcome; prRef?: string;
}
export interface LeadTime {
  prRef: string; repo?: string; pr?: number;
  openedAt?: string; mergedAt?: string; queuedToMergedHours?: number;
}
/** Only `done` is terminal — blocked/abandoned releases re-queue (F1 semantics). */
export type ItemState = 'queued' | 'claimed' | 'stale' | 'done';
export interface ItemFlow {
  itemId: string; productKey: string; title: string; queuedAt: string;
  claims: ClaimSpan[]; state: ItemState; requeues: number;
  queueHours?: number; activeHours?: number; lead?: LeadTime;
}
export interface ProductFlow {
  productKey: string; items: ItemFlow[];
  queued: number; inFlight: number; stale: number; done: number;
  blockedReleases: number; abandonedReleases: number;
  medianQueueHours?: number; medianActiveHours?: number;
}

const hours = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;
const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

export function flowSummary(events: DomainEventEnvelope[], now: Date, productKey?: string): ProductFlow[] {
  const items = new Map<string, ItemFlow>();
  for (const e of ofType(events, F_EVENT.ITEM_QUEUED)) {
    const p = e.payload as unknown as QueuedPayload;
    items.set(p.itemId, {
      itemId: p.itemId, productKey: p.productKey, title: p.title, queuedAt: e.occurredAt,
      claims: [], state: 'queued', requeues: 0,
    });
  }
  for (const e of ofType(events, F_EVENT.CLAIM_ACQUIRED)) {
    const p = e.payload as unknown as AcquiredPayload;
    items.get(p.itemId)?.claims.push({
      claimId: p.claimId, sessionId: p.sessionId, acquiredAt: e.occurredAt, ttlMinutes: p.ttlMinutes,
    });
  }
  for (const e of ofType(events, F_EVENT.CLAIM_RELEASED)) {
    const p = e.payload as unknown as ReleasedPayload;
    const span = items.get(p.itemId)?.claims.find((c) => c.claimId === p.claimId);
    if (span) { span.releasedAt = e.occurredAt; span.outcome = p.outcome; span.prRef = p.prRef; }
  }
  for (const item of items.values()) deriveItem(item, events, now);
  const byProduct = new Map<string, ItemFlow[]>();
  for (const item of items.values()) {
    if (productKey && item.productKey !== productKey) continue;
    let arr = byProduct.get(item.productKey);
    if (!arr) { arr = []; byProduct.set(item.productKey, arr); }
    arr.push(item);
  }
  return [...byProduct.entries()]
    .map(([key, its]) => summarize(key, its))
    .sort((a, b) => a.productKey.localeCompare(b.productKey));
}

function deriveItem(item: ItemFlow, events: DomainEventEnvelope[], now: Date): void {
  const first = item.claims[0];
  if (first) item.queueHours = hours(item.queuedAt, first.acquiredAt);
  const released = item.claims.filter((c) => c.releasedAt);
  const spans = released.map((c) => hours(c.acquiredAt, c.releasedAt!));
  if (spans.length) item.activeHours = spans.reduce((s, x) => s + x, 0);
  item.requeues = released.filter((c) => c.outcome !== 'done').length;
  const open = item.claims.find((c) => !c.releasedAt);
  const doneClaim = released.find((c) => c.outcome === 'done');
  if (doneClaim) item.state = 'done';
  else if (open)
    item.state = now.getTime() > Date.parse(open.acquiredAt) + open.ttlMinutes * 60_000 ? 'stale' : 'claimed';
  else item.state = 'queued';
  if (doneClaim?.prRef) item.lead = joinLead(doneClaim.prRef, item.queuedAt, events);
}

function joinLead(prRef: string, queuedAt: string, events: DomainEventEnvelope[]): LeadTime {
  const parsed = parsePrRef(prRef);
  if (!parsed) return { prRef }; // unparseable — render with a provenance note, never throw
  const match = (e: DomainEventEnvelope) => {
    const p = e.payload as unknown as { repo: string; pr: number };
    return p.repo === parsed.repo && p.pr === parsed.pr;
  };
  const openedAt = ofType(events, EVENT.PR_OPENED).find(match)?.occurredAt;
  const mergedAt = ofType(events, EVENT.PR_MERGED).find(match)?.occurredAt;
  return {
    prRef, repo: parsed.repo, pr: parsed.pr, openedAt, mergedAt,
    queuedToMergedHours: mergedAt ? hours(queuedAt, mergedAt) : undefined,
  };
}

function summarize(productKey: string, items: ItemFlow[]): ProductFlow {
  const released = items.flatMap((i) => i.claims.filter((c) => c.releasedAt));
  const defined = (xs: Array<number | undefined>) => xs.filter((x): x is number => x !== undefined);
  return {
    productKey,
    items: [...items].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    queued: items.filter((i) => i.state === 'queued').length,
    inFlight: items.filter((i) => i.state === 'claimed').length,
    stale: items.filter((i) => i.state === 'stale').length,
    done: items.filter((i) => i.state === 'done').length,
    blockedReleases: released.filter((c) => c.outcome === 'blocked').length,
    abandonedReleases: released.filter((c) => c.outcome === 'abandoned').length,
    medianQueueHours: median(defined(items.map((i) => i.queueHours))),
    medianActiveHours: median(defined(items.map((i) => i.activeHours))),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd domains/devloop && npx vitest run test/flow.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd domains/devloop && git add src/inference/flow.ts test/flow.test.ts && git commit -m "feat(f6): flow readout — foundry item ladders + end-to-end prRef lead-time join"
```

---

### Task 3: Wave advisory readout

**Files:**
- Create: `domains/devloop/src/inference/wave.ts`
- Create: `domains/devloop/test/wave.test.ts`

- [ ] **Step 1: Write the failing test**

Create `domains/devloop/test/wave.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { waveAdvisory } from '../src/inference/wave.js';
import { finding, findingResolved } from '../src/events.js';

const TS = '2026-06-10T00:00:00Z';
// path is required for a finding to count as resolvable (findingsSummary semantics)
const f = (commentId: number, verifier: string, repo = 'o/r') =>
  finding({ repo, pr: 1, verifier, severity: 'should-fix', path: 'src/a.ts', line: 1, commentId, text: 'x', ts: TS });
const resolved = (commentId: number, repo = 'o/r') =>
  findingResolved({ repo, pr: 1, commentId, addressed: true, ts: TS });

describe('waveAdvisory', () => {
  it('recommends the standard wave when there is no findings history', () => {
    const w = waveAdvisory([], 'o/r');
    expect(w.standardWave).toEqual(['local-ci', 'reviewer', 'charter-checker', 'qa-engineer']);
    expect(w.advice).toEqual([]);
    expect(w.note).toMatch(/no findings history/);
  });

  it('adds exercir-charter-checker for the exercir repo', () => {
    expect(waveAdvisory([], 'de-braighter/exercir').standardWave).toContain('exercir-charter-checker');
  });

  it('keeps a verifier with insufficient data, saying so', () => {
    const w = waveAdvisory([f(1, 'reviewer')], 'o/r');
    expect(w.advice[0]).toMatchObject({ verifier: 'reviewer', action: 'keep', n: 1 });
    expect(w.advice[0]?.reason).toMatch(/insufficient data/);
  });

  it('flags a low-precision verifier for review, with the evidence', () => {
    const events = [1, 2, 3, 4, 5, 6].map((id) => f(id, 'copilot'));
    events.push(resolved(1), resolved(2)); // 2/6 ≈ 33% < 50% floor
    const a = waveAdvisory(events, 'o/r').advice.find((x) => x.verifier === 'copilot');
    expect(a).toMatchObject({ action: 'review', n: 6 });
    expect(a?.precision).toBeCloseTo(1 / 3);
    expect(a?.reason).toMatch(/re-prompt or replace/);
  });

  it('keeps a healthy-precision verifier', () => {
    const events = [1, 2, 3, 4, 5].map((id) => f(id, 'reviewer'));
    events.push(resolved(1), resolved(2), resolved(3), resolved(4)); // 4/5 = 80%
    const a = waveAdvisory(events, 'o/r').advice.find((x) => x.verifier === 'reviewer');
    expect(a).toMatchObject({ action: 'keep', n: 5 });
    expect(a?.precision).toBeCloseTo(0.8);
  });

  it('scopes to the requested repo only', () => {
    const events = [1, 2, 3, 4, 5, 6].map((id) => f(id, 'copilot', 'other/repo'));
    const w = waveAdvisory(events, 'o/r');
    expect(w.advice).toEqual([]);
    expect(w.note).toMatch(/no findings history/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd domains/devloop && npx vitest run test/wave.test.ts
```

Expected: FAIL — `Cannot find module '../src/inference/wave.js'`.

- [ ] **Step 3: Write the implementation**

Create `domains/devloop/src/inference/wave.ts`:

```typescript
// F6 wave advisory — turn per-verifier finding precision (inference/findings.ts,
// precision = addressed/resolvable) into ADVISORY wave-composition advice per repo.
// Deterministic and evidence-carrying; never a config artifact (founder decision
// 2026-06-12): the composing session decides, this readout informs. Thresholds are
// named constants surfaced in the output so the advice is self-explaining.
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { findingsSummary } from './findings.js';

export const MIN_SAMPLE = 5;        // resolvable findings needed before precision is judged
export const PRECISION_FLOOR = 0.5; // below this (with n >= MIN_SAMPLE) -> review the verifier

/** The default wave from workflows/verifier-wave.md (workbench repo). */
export const STANDARD_WAVE = ['local-ci', 'reviewer', 'charter-checker', 'qa-engineer'] as const;

export interface WaveAdvice {
  verifier: string;
  action: 'keep' | 'review';
  n: number;
  precision?: number;
  reason: string;
}
export interface WaveAdvisory { repo: string; standardWave: string[]; advice: WaveAdvice[]; note: string; }

export function waveAdvisory(events: DomainEventEnvelope[], repo: string): WaveAdvisory {
  const standardWave = [...STANDARD_WAVE, ...(repo.includes('exercir') ? ['exercir-charter-checker'] : [])];
  const s = findingsSummary(events, repo);
  if (!s.total) return { repo, standardWave, advice: [], note: 'no findings history — standard wave' };
  const advice = s.byVerifier.map((v): WaveAdvice => {
    if (v.resolvable < MIN_SAMPLE)
      return { verifier: v.verifier, action: 'keep', n: v.resolvable, reason: `insufficient data (n=${v.resolvable} < ${MIN_SAMPLE}) — standard wave` };
    const precision = v.precision ?? 0;
    return precision < PRECISION_FLOOR
      ? { verifier: v.verifier, action: 'review', n: v.resolvable, precision, reason: `precision ${(precision * 100).toFixed(0)}% < ${PRECISION_FLOOR * 100}% floor (n=${v.resolvable}) — re-prompt or replace (advisory)` }
      : { verifier: v.verifier, action: 'keep', n: v.resolvable, precision, reason: `precision ${(precision * 100).toFixed(0)}% (n=${v.resolvable})` };
  });
  return { repo, standardWave, advice, note: `advisory only — thresholds: precision floor ${PRECISION_FLOOR}, min sample ${MIN_SAMPLE}` };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd domains/devloop && npx vitest run test/wave.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd domains/devloop && git add src/inference/wave.ts test/wave.test.ts && git commit -m "feat(f6): wave advisory — per-repo verifier-precision readout (advisory only)"
```

---

### Task 4: CLI renderers, usage text, ritual wiring, full gate

**Files:**
- Modify: `domains/devloop/src/cli.ts` (imports, two renderers, two cases, usage lines)
- Modify: `domains/devloop/package.json` (`ritual:post-merge`)

- [ ] **Step 1: Add imports to `src/cli.ts`**

After the existing `inference/*` imports add:

```typescript
import { flowSummary } from './inference/flow.js';
import { waveAdvisory } from './inference/wave.js';
```

- [ ] **Step 2: Add the renderers**

Add next to the other `show*` functions (they use the existing `fmtH` helper):

```typescript
function showFlow(productKey?: string): void {
  const events = readEnvelopes();
  const products = flowSummary(events, new Date(), productKey);
  if (!products.length) { console.log('No foundry events in the log — run `ingest-foundry` first.'); return; }
  for (const p of products) {
    console.log(`FLOW — ${p.productKey}: ${p.items.length} item(s) | ${p.queued} queued, ${p.inFlight} in-flight, ${p.stale} stale, ${p.done} done | ${p.blockedReleases} blocked / ${p.abandonedReleases} abandoned release(s)`);
    if (p.medianQueueHours !== undefined)
      console.log(`   median time-in-queue ${fmtH(p.medianQueueHours)}   median released-claim duration ${p.medianActiveHours !== undefined ? fmtH(p.medianActiveHours) : 'n/a'}`);
    for (const i of p.items) {
      const lead = !i.lead ? ''
        : i.lead.queuedToMergedHours !== undefined ? `   queued->merged ${fmtH(i.lead.queuedToMergedHours)} (${i.lead.prRef})`
        : i.lead.repo ? `   PR not in twin log — run: backfill ${i.lead.repo}`
        : `   unparseable prRef '${i.lead.prRef}'`;
      console.log(`   ${i.itemId.padEnd(32)} ${i.state.padEnd(8)} queue ${i.queueHours !== undefined ? fmtH(i.queueHours) : 'n/a'}  active ${i.activeHours !== undefined ? fmtH(i.activeHours) : 'n/a'}  requeues ${i.requeues}${lead}`);
    }
    console.log('');
  }
}

function showWave(repo: string): void {
  if (!repo) { console.log('usage: wave <owner/repo>'); return; }
  const w = waveAdvisory(readEnvelopes(), repo);
  console.log(`WAVE ADVISORY — ${repo} (${w.note})`);
  console.log(`   standard wave: ${w.standardWave.join(', ')}`);
  for (const a of w.advice)
    console.log(`   ${a.action === 'review' ? '!! ' : '   '}${a.verifier.padEnd(18)} ${a.action.padEnd(6)} ${a.reason}`);
}
```

- [ ] **Step 3: Add the switch cases**

Next to `case 'findings':`:

```typescript
  case 'flow': showFlow(rest[0]); break;
  case 'wave': showWave(rest[0] ?? ''); break;
```

- [ ] **Step 4: Update the usage texts**

In the doc comment at the top of `cli.ts`, after the `whatif` line add:

```typescript
//   devloop ingest-foundry        pull the foundry control plane's event log (dedup by eventId)
//   devloop flow [product]        foundry queue/claim flow + end-to-end lead time
//   devloop wave <owner/repo>     advisory wave composition from finding precision
```

In the `default:` usage string, extend the command list with `|ingest-foundry|flow|wave` (keep alphabetic-ish placement near `findings`).

- [ ] **Step 5: Wire the ritual**

In `domains/devloop/package.json`, replace the `ritual:post-merge` script value with (one added segment after `resolve-findings`; `ingest-foundry` exits 0 when the sibling clone is absent, so the `&&` chain stays safe):

```json
"ritual:post-merge": "tsx src/cli.ts backfill de-braighter/devloop && tsx src/cli.ts reviews de-braighter/devloop && tsx src/cli.ts resolve-findings de-braighter/devloop && tsx src/cli.ts ingest-foundry && npm run test:coverage && npm run sonar:scan && tsx src/cli.ts reconcile && tsx src/cli.ts calibration",
```

- [ ] **Step 6: Live smoke + full gate**

```bash
cd domains/devloop && npm run dev -- flow && npm run dev -- wave de-braighter/devloop && npm run typecheck && npm test
```

Expected: `flow` renders the agri-ecosystem-twin product (E1 done with a `queued->merged` ladder if `backfill de-braighter/agri-ecosystem-twin` has run, else the `PR not in twin log` hint; other items queued). `wave` renders devloop's real per-verifier precision (copilot was live at 33%). Typecheck clean, full vitest suite green.

- [ ] **Step 7: Commit**

```bash
cd domains/devloop && git add src/cli.ts package.json && git commit -m "feat(f6): flow + wave CLI readouts, ingest-foundry in the post-merge ritual"
```

---

### Task 5: Workbench docs — verifier-wave touch + spec + plan

**Files (workbench repo `D:/development/projects/de-braighter`, branch `docs/f6-twin-integration`):**
- Modify: `workflows/verifier-wave.md`
- Add: `docs/superpowers/specs/2026-06-12-foundry-f6-twin-integration-design.md` (already written locally)
- Add: `docs/superpowers/plans/2026-06-12-foundry-f6-twin-integration.md` (this file)

- [ ] **Step 1: Branch in the workbench**

```bash
cd D:/development/projects/de-braighter && git checkout -b docs/f6-twin-integration
```

- [ ] **Step 2: Add the "Consult the twin" section to `workflows/verifier-wave.md`**

Insert after the "## The agents" section's table (before whatever section follows it), and bump the frontmatter `last_updated` to `2026-06-12`:

```markdown
## Consult the twin (advisory)

Before composing a wave on a repo with PR-findings history, ask the twin what the finding
record says about each verifier there:

​```bash
cd domains/devloop && npm run dev -- wave <owner/repo>
​```

The readout reports per-verifier finding precision with sample sizes and flags low-precision
verifiers ("re-prompt or replace"). It is **advisory** — the composing session decides; thin
data falls back to the standard wave above. (F6; spec
`docs/superpowers/specs/2026-06-12-foundry-f6-twin-integration-design.md`.)
```

(Remove the zero-width characters from the inner fence when applying — they only protect this plan's own code block.)

- [ ] **Step 3: Commit (explicit paths — NEVER `git add -A` in the workbench)**

```bash
cd D:/development/projects/de-braighter && git add workflows/verifier-wave.md docs/superpowers/specs/2026-06-12-foundry-f6-twin-integration-design.md docs/superpowers/plans/2026-06-12-foundry-f6-twin-integration.md && git commit -m "docs(foundry): F6 twin-integration spec + plan; wave-advisory note in verifier-wave"
```

---

### Task 6: Land both PRs (cluster protocol)

- [ ] **Step 1: Open the devloop PR** (PR-first so the wave's findings are postable)

```bash
cd domains/devloop && git push -u origin feat/f6-twin-integration && gh pr create --title "feat(f6): foundry twin integration — ingest-foundry, flow + wave readouts" --body "Implements F6 per workbench spec docs/superpowers/specs/2026-06-12-foundry-f6-twin-integration-design.md.

- ingest-foundry: pull the foundry event log, dedup by eventId, verbatim envelopes
- flow [product]: queue/claim ladders + end-to-end prRef lead-time join
- wave <owner/repo>: ADVISORY per-verifier precision readout (floor 0.5, min n=5)
- ritual:post-merge now ingests foundry exhaust (non-blocking when sibling absent)

Producer: orchestrator/claude-fable-5 [brainstorming, writing-plans, subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert
Effect: findings 3±3 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Open the workbench PR**

```bash
cd D:/development/projects/de-braighter && git push -u origin docs/f6-twin-integration && gh pr create --title "docs(foundry): F6 twin-integration spec + plan + wave-advisory workflow note" --body "Spec + implementation plan for F6 (the last foundry sub-project), and the advisory consult-the-twin paragraph in verifier-wave.md. Code lands in devloop (companion PR).

Producer: orchestrator/claude-fable-5 [brainstorming, writing-plans]
Effort: standard
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Verifier wave on the devloop PR** — `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` in parallel, all `isolation: "worktree"`, prompts must forbid git ops in shared clones. Workbench PR is docs-only → wave skip rule applies (pure docs), but give it a quick `md-quality` eye.

- [ ] **Step 4: Findings ritual (BEFORE merge)** — `npm run dev -- drain de-braighter/devloop#<pr>`; write wave findings to a temp JSON `[{verifier, severity, path?, line?, text}]` (severity enum `blocking|should-fix|nit|note`; paths must be in the diff); `npm run dev -- post-findings de-braighter/devloop#<pr> findings.json`; fix what's actionable in-PR.

- [ ] **Step 5: Merge both + twin ritual**

```bash
cd domains/devloop && gh pr merge <pr> --squash && gh pr view <pr> --json state   # verify MERGED (empty-output trap)
npm run ritual:post-merge
```

Then merge the workbench PR the same way (`backfill de-braighter/workbench` afterwards picks it up). Note the ritual now *itself* runs `ingest-foundry` — F6 starts feeding the twin on its own merge.

---

## Self-review notes

- **Spec coverage:** §3.1 ingest → Task 1; §3.2 flow + §3.2-join → Task 2; §3.3 wave → Task 3; CLI + ritual wiring (§3.1 last bullet) → Task 4; §3.4 doc touch → Task 5; §4 failure stances → Task 1 tests (missing source, corrupt line) + `joinLead` unparseable-prRef branch + `showFlow` empty-log message; §5 testing matrix → Tasks 1–3 test files. Consumer-sweep safety note (§3.1): `grep -rn "packId" src/` shows only `scope.ts` (constant definition) — folds select by `eventType`; snapshot/KG iterate `ofType`-filtered views. Re-verify during Task 4's full suite run.
- **Type consistency:** `ingestFoundry(sourcePath, logPath) → FoundryIngestResult{appended, skipped, sourceMissing, sourcePath}` used identically in Task 1 test/impl/CLI. `flowSummary(events, now, productKey?) → ProductFlow[]` with `ItemFlow.state: 'queued'|'claimed'|'stale'|'done'` consistent across Task 2 and Task 4 renderer. `waveAdvisory(events, repo) → WaveAdvisory{standardWave, advice, note}` consistent across Task 3 and Task 4.
- **No placeholders:** every code step carries the full code; every run step carries the command + expected outcome.
