# Markets Phase 2a — Spine Functions + Adapters + Observations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three pure spine functions (`captureProvenance`, `deriveHealth`, `capConfidence`) to `libs/source-spine`, add `CoinGeckoAdapter` + `FixtureAdapter` + `toObservationEnvelopes` to `libs/markets-pack`, and keep the full workspace gate green — all without touching a database.

**Architecture:** Pure TypeScript only — no NestJS, no Prisma, no DB. `libs/source-spine` gets helper functions alongside the existing `SourcePort` contract. `libs/markets-pack` gains adapters + observation mapping that produce `DomainEventEnvelope[]` from a CoinGecko fetch. The `@de-braighter/substrate-contracts` package is added to `markets-pack` as a type-only dependency for `DomainEventEnvelope`. This sub-phase ships as its own PR; Phase 2b wires the result to Postgres.

**Tech Stack:** TypeScript 5.4 (NodeNext ESM), Vitest 1.6.1, `node:crypto` (built-in), `globalThis.fetch` (Node 18+ native). No new runtime deps in `source-spine`. `@de-braighter/substrate-contracts@^0.14.0` added to `markets-pack`.

**Spec:** `docs/superpowers/specs/2026-06-03-markets-phase2-spine-ingestion-design.md`

**Repo:** `D:/development/projects/de-braighter/domains/markets/` (6 commits on `main`; pnpm workspace)

**Note on workspace builds:** `markets-api` tests depend on built `markets-pack` dist/. Always run `pnpm install && pnpm run build` from the workspace root before running `markets-api` tests. `source-spine` and `markets-pack` tests are self-contained.

---

## File Structure

```
libs/source-spine/src/
  provenance.ts          ← new: captureProvenance(sourceId, raw) → Provenance
  provenance.spec.ts     ← new: TDD for captureProvenance
  source-health.ts       ← new: deriveHealth(fetchedAt, now, budget) → SourceHealthStatus
  source-health.spec.ts  ← new: TDD for deriveHealth
  confidence-gate.ts     ← new: capConfidence(raw, health, required) → number
  confidence-gate.spec.ts← new: TDD for capConfidence
  index.ts               ← modified: re-export the 3 new functions

libs/markets-pack/
  package.json           ← modified: add @de-braighter/substrate-contracts dep
  src/
    constants.ts         ← new: PACK_ID + ASSET_IDS constants (extracted to break circular dep)
    sources/
      coingecko.adapter.ts      ← new: CoinGeckoAdapter (live HTTP)
      coingecko.adapter.spec.ts ← new: TDD with mocked globalThis.fetch
      fixture.adapter.ts        ← new: FixtureAdapter (hardcoded snapshot)
      fixture.adapter.spec.ts   ← new: TDD for FixtureAdapter
    observations.ts       ← new: toObservationEnvelopes(tenantPackId, fetchResult)
    observations.spec.ts  ← new: TDD for envelope shape
    index.ts              ← modified: re-export new public surface; PACK_ID now from constants.ts
```

---

## Task 1: `provenance.ts` (TDD)

**Files:**
- Create: `libs/source-spine/src/provenance.spec.ts`
- Create: `libs/source-spine/src/provenance.ts`

- [ ] **Step 1: Write the failing test**

`libs/source-spine/src/provenance.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { captureProvenance } from './provenance.js';

describe('captureProvenance', () => {
  it('returns a Provenance with the given sourceId', () => {
    const p = captureProvenance('my-source', { price: 100 });
    expect(p.sourceId).toBe('my-source');
  });

  it('fetchedAt is an ISO 8601 UTC string', () => {
    const p = captureProvenance('s', {});
    expect(p.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(() => new Date(p.fetchedAt).toISOString()).not.toThrow();
  });

  it('payloadHash is a 64-char lowercase hex sha256', () => {
    const p = captureProvenance('s', { foo: 'bar' });
    expect(p.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same payload → same hash (deterministic)', () => {
    const p1 = captureProvenance('s', { x: 1 });
    const p2 = captureProvenance('s', { x: 1 });
    expect(p1.payloadHash).toBe(p2.payloadHash);
  });

  it('different payload → different hash', () => {
    const p1 = captureProvenance('s', { x: 1 });
    const p2 = captureProvenance('s', { x: 2 });
    expect(p1.payloadHash).not.toBe(p2.payloadHash);
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/source-spine
pnpm run test
```
Expected: FAIL with `Cannot find module './provenance.js'`

- [ ] **Step 3: Write `provenance.ts`**

```typescript
import { createHash } from 'node:crypto';
import type { Provenance } from './source-port.js';

export function captureProvenance(sourceId: string, raw: unknown): Provenance {
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(raw))
    .digest('hex');
  return {
    sourceId,
    fetchedAt: new Date().toISOString(),
    payloadHash,
  };
}
```

- [ ] **Step 4: Run the test — must PASS**

```bash
pnpm run test
```
Expected: 5 tests passed.

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/source-spine/src/provenance.ts libs/source-spine/src/provenance.spec.ts
git commit -m "feat(source-spine): captureProvenance — sha256 audit trail

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: `source-health.ts` (TDD)

**Files:**
- Create: `libs/source-spine/src/source-health.spec.ts`
- Create: `libs/source-spine/src/source-health.ts`

- [ ] **Step 1: Write the failing test**

`libs/source-spine/src/source-health.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { deriveHealth } from './source-health.js';

const BASE = '2026-06-03T12:00:00.000Z';
const after = (ms: number) => new Date(Date.parse(BASE) + ms).toISOString();
const BUDGET = 60_000; // 1 minute

describe('deriveHealth', () => {
  it('returns online when delta = 0 (same instant)', () => {
    expect(deriveHealth(BASE, BASE, BUDGET)).toBe('online');
  });

  it('returns online when delta < budget', () => {
    expect(deriveHealth(BASE, after(30_000), BUDGET)).toBe('online');
  });

  it('returns online when delta = budget - 1', () => {
    expect(deriveHealth(BASE, after(BUDGET - 1), BUDGET)).toBe('online');
  });

  it('returns stale when delta = budget', () => {
    expect(deriveHealth(BASE, after(BUDGET), BUDGET)).toBe('stale');
  });

  it('returns stale when budget ≤ delta < budget × 3', () => {
    expect(deriveHealth(BASE, after(BUDGET * 2), BUDGET)).toBe('stale');
    expect(deriveHealth(BASE, after(BUDGET * 3 - 1), BUDGET)).toBe('stale');
  });

  it('returns offline when delta = budget × 3', () => {
    expect(deriveHealth(BASE, after(BUDGET * 3), BUDGET)).toBe('offline');
  });

  it('returns offline when delta > budget × 3', () => {
    expect(deriveHealth(BASE, after(BUDGET * 10), BUDGET)).toBe('offline');
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/source-spine
pnpm run test
```
Expected: FAIL with `Cannot find module './source-health.js'`

- [ ] **Step 3: Write `source-health.ts`**

```typescript
import type { SourceHealthStatus } from './source-port.js';

export function deriveHealth(
  fetchedAt: string,
  now: string,
  latencyBudgetMs: number,
): SourceHealthStatus {
  const delta = Date.parse(now) - Date.parse(fetchedAt);
  if (delta < latencyBudgetMs) return 'online';
  if (delta < latencyBudgetMs * 3) return 'stale';
  return 'offline';
}
```

- [ ] **Step 4: Run the test — must PASS**

```bash
pnpm run test
```
Expected: 7 tests passed (plus the 5 from Task 1 — 12 total if run together, or 7 if run in isolation on this file).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/source-spine/src/source-health.ts libs/source-spine/src/source-health.spec.ts
git commit -m "feat(source-spine): deriveHealth — online/stale/offline from feed freshness

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `confidence-gate.ts` (TDD)

**Files:**
- Create: `libs/source-spine/src/confidence-gate.spec.ts`
- Create: `libs/source-spine/src/confidence-gate.ts`

- [ ] **Step 1: Write the failing test**

`libs/source-spine/src/confidence-gate.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { capConfidence } from './confidence-gate.js';

describe('capConfidence', () => {
  it('passes raw through when source is online (required)', () => {
    expect(capConfidence(0.85, 'online', true)).toBe(0.85);
  });

  it('passes raw through when source is online (not required)', () => {
    expect(capConfidence(0.85, 'online', false)).toBe(0.85);
  });

  it('passes raw through when source is stale and not required', () => {
    expect(capConfidence(0.85, 'stale', false)).toBe(0.85);
  });

  it('passes raw through when source is offline and not required', () => {
    expect(capConfidence(0.85, 'offline', false)).toBe(0.85);
  });

  it('caps to 0 when required and stale', () => {
    expect(capConfidence(0.85, 'stale', true)).toBe(0);
  });

  it('caps to 0 when required and offline', () => {
    expect(capConfidence(0.85, 'offline', true)).toBe(0);
  });

  it('works with extreme raw values', () => {
    expect(capConfidence(1.0, 'online', true)).toBe(1.0);
    expect(capConfidence(1.0, 'stale', true)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/source-spine
pnpm run test
```
Expected: FAIL with `Cannot find module './confidence-gate.js'`

- [ ] **Step 3: Write `confidence-gate.ts`**

```typescript
import type { SourceHealthStatus } from './source-port.js';

export function capConfidence(
  raw: number,
  health: SourceHealthStatus,
  required: boolean,
): number {
  if (required && health !== 'online') return 0;
  return raw;
}
```

- [ ] **Step 4: Run all source-spine tests — must all PASS**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/source-spine
pnpm run test
```
Expected: all tests passed (1 original + 5 + 7 + 7 = 20 total).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/source-spine/src/confidence-gate.ts libs/source-spine/src/confidence-gate.spec.ts
git commit -m "feat(source-spine): capConfidence — caps posterior to 0 when required source not online

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Update `source-spine/src/index.ts` + build

**Files:**
- Modify: `libs/source-spine/src/index.ts`

- [ ] **Step 1: Update `index.ts` to re-export the three new functions**

Replace the entire content of `libs/source-spine/src/index.ts` with:
```typescript
export type {
  SourceHealthStatus,
  SourceDescriptor,
  Provenance,
  SourceFetch,
  SourceError,
  SourceResult,
  SourcePort,
} from './source-port.js';

export { captureProvenance } from './provenance.js';
export { deriveHealth } from './source-health.js';
export { capConfidence } from './confidence-gate.js';
```

- [ ] **Step 2: Build and typecheck**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/source-spine
pnpm run typecheck && pnpm run build
```
Expected: no errors; `dist/index.js` now includes the three new function exports.

- [ ] **Step 3: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/source-spine/src/index.ts
git commit -m "feat(source-spine): export captureProvenance, deriveHealth, capConfidence

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Add `substrate-contracts` dep + `constants.ts` to `markets-pack`

**Files:**
- Modify: `libs/markets-pack/package.json`
- Create: `libs/markets-pack/src/constants.ts`
- Modify: `libs/markets-pack/src/index.ts`

**Why `constants.ts`:** `index.ts` will re-export from `observations.ts`, and `observations.ts` needs `PACK_ID`. If `observations.ts` imports from `index.ts`, that's a circular dep. Extract `PACK_ID` and `ASSET_IDS` into `constants.ts` instead.

- [ ] **Step 1: Add `@de-braighter/substrate-contracts` to `markets-pack/package.json`**

Edit `libs/markets-pack/package.json` — add under `"dependencies"`:
```json
"@de-braighter/substrate-contracts": "^0.14.0"
```

Full `dependencies` block:
```json
"dependencies": {
  "@de-braighter/markets-source-spine": "workspace:*",
  "@de-braighter/substrate-contracts": "^0.14.0"
}
```

- [ ] **Step 2: Write `constants.ts`**

`libs/markets-pack/src/constants.ts`:
```typescript
export const PACK_ID = 'markets' as const;

export const ASSET_IDS = {
  bitcoin:  '00000000-0001-4000-8000-000000000001',
  ethereum: '00000000-0002-4000-8000-000000000002',
  cardano:  '00000000-0003-4000-8000-000000000003',
} as const;

export type AssetKey = keyof typeof ASSET_IDS;
```

- [ ] **Step 3: Update `index.ts` to import `PACK_ID` from `constants.ts`**

Replace the entire content of `libs/markets-pack/src/index.ts`:
```typescript
export type { SourcePort, SourceDescriptor, SourceResult } from '@de-braighter/markets-source-spine';
export { PACK_ID } from './constants.js';
```
(Adapters and observations will be added in later tasks.)

- [ ] **Step 4: Run the existing test — must still pass**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm install
cd libs/markets-pack
pnpm run test
```
Expected: 1 test passed (`PACK_ID === 'markets'`).

- [ ] **Step 5: Build and typecheck**

```bash
pnpm run typecheck && pnpm run build
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/markets-pack/package.json libs/markets-pack/src/constants.ts libs/markets-pack/src/index.ts pnpm-lock.yaml
git commit -m "feat(markets-pack): add substrate-contracts dep + extract constants (PACK_ID, ASSET_IDS)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `CoinGeckoAdapter` (TDD)

**Files:**
- Create: `libs/markets-pack/src/sources/coingecko.adapter.spec.ts`
- Create: `libs/markets-pack/src/sources/coingecko.adapter.ts`

- [ ] **Step 1: Write the failing test**

`libs/markets-pack/src/sources/coingecko.adapter.spec.ts`:
```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoinGeckoAdapter } from './coingecko.adapter.js';

afterEach(() => { vi.unstubAllGlobals(); });

const VALID_PAYLOAD = {
  bitcoin:  { usd: 67_000, last_updated_at: 1_748_908_800 },
  ethereum: { usd: 3_500,  last_updated_at: 1_748_908_800 },
  cardano:  { usd: 0.45,   last_updated_at: 1_748_908_800 },
};

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    }),
  );
}

function stubFetchNetworkError(): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
}

describe('CoinGeckoAdapter', () => {
  it('descriptor.id is coingecko and required is true', () => {
    const a = new CoinGeckoAdapter();
    expect(a.descriptor.id).toBe('coingecko');
    expect(a.descriptor.required).toBe(true);
    expect(a.descriptor.latencyBudgetMs).toBe(120_000);
  });

  it('returns ok:true with all three assets and a provenance on success', async () => {
    stubFetch(200, VALID_PAYLOAD);
    const result = await new CoinGeckoAdapter().fetch();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.payload['bitcoin']?.usd).toBe(67_000);
    expect(result.value.payload['ethereum']?.usd).toBe(3_500);
    expect(result.value.payload['cardano']?.usd).toBe(0.45);
    expect(result.value.provenance.sourceId).toBe('coingecko');
    expect(result.value.provenance.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns ok:false kind:rate-limited on HTTP 429', async () => {
    stubFetch(429, 'rate limited');
    const result = await new CoinGeckoAdapter().fetch();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('rate-limited');
  });

  it('returns ok:false kind:unreachable on non-429 HTTP error', async () => {
    stubFetch(500, 'server error');
    const result = await new CoinGeckoAdapter().fetch();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('unreachable');
  });

  it('returns ok:false kind:unreachable on network error', async () => {
    stubFetchNetworkError();
    const result = await new CoinGeckoAdapter().fetch();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('unreachable');
  });

  it('returns ok:false kind:bad-shape when an asset key is missing', async () => {
    stubFetch(200, { bitcoin: { usd: 67_000, last_updated_at: 0 } }); // missing ethereum + cardano
    const result = await new CoinGeckoAdapter().fetch();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('bad-shape');
  });

  it('returns ok:false kind:bad-shape on non-object JSON', async () => {
    stubFetch(200, 'not an object');
    const result = await new CoinGeckoAdapter().fetch();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('bad-shape');
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: FAIL with `Cannot find module './coingecko.adapter.js'`

- [ ] **Step 3: Write `coingecko.adapter.ts`**

`libs/markets-pack/src/sources/coingecko.adapter.ts`:
```typescript
import { captureProvenance } from '@de-braighter/markets-source-spine';
import type {
  SourceDescriptor,
  SourcePort,
  SourceResult,
} from '@de-braighter/markets-source-spine';
import type { AssetKey } from '../constants.js';

export type CoinGeckoPricePayload = Record<string, {
  readonly usd: number;
  readonly last_updated_at: number;
}>;

const ASSETS: readonly AssetKey[] = ['bitcoin', 'ethereum', 'cardano'];

const PRICE_URL =
  'https://api.coingecko.com/api/v3/simple/price' +
  '?ids=bitcoin,ethereum,cardano&vs_currencies=usd&include_last_updated_at=true';

export class CoinGeckoAdapter implements SourcePort<CoinGeckoPricePayload> {
  readonly descriptor: SourceDescriptor = {
    id: 'coingecko',
    name: 'CoinGecko /simple/price',
    category: 'crypto-price',
    required: true,
    latencyBudgetMs: 120_000,
  };

  async fetch(): Promise<SourceResult<CoinGeckoPricePayload>> {
    let text: string;
    let httpStatus: number;

    try {
      const res = await globalThis.fetch(PRICE_URL);
      httpStatus = res.status;
      text = await res.text();
    } catch (err) {
      return { ok: false, error: { kind: 'unreachable', detail: String(err) } };
    }

    if (httpStatus === 429) {
      return { ok: false, error: { kind: 'rate-limited', detail: 'HTTP 429 from CoinGecko' } };
    }
    if (httpStatus < 200 || httpStatus >= 300) {
      return { ok: false, error: { kind: 'unreachable', detail: `HTTP ${httpStatus}` } };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, error: { kind: 'bad-shape', detail: 'response is not valid JSON' } };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: { kind: 'bad-shape', detail: 'response root is not an object' } };
    }

    for (const asset of ASSETS) {
      if (!(asset in parsed)) {
        return { ok: false, error: { kind: 'bad-shape', detail: `missing asset key: ${asset}` } };
      }
    }

    const payload = parsed as CoinGeckoPricePayload;
    const provenance = captureProvenance('coingecko', payload);
    return { ok: true, value: { payload, provenance } };
  }
}
```

- [ ] **Step 4: Run the test — must PASS**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: 7 CoinGeckoAdapter tests passed (plus 1 existing pack-id test = 8 total).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/markets-pack/src/sources/coingecko.adapter.ts libs/markets-pack/src/sources/coingecko.adapter.spec.ts
git commit -m "feat(markets-pack): CoinGeckoAdapter — live BTC/ETH/ADA price fetch

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: `FixtureAdapter` (TDD)

**Files:**
- Create: `libs/markets-pack/src/sources/fixture.adapter.spec.ts`
- Create: `libs/markets-pack/src/sources/fixture.adapter.ts`

- [ ] **Step 1: Write the failing test**

`libs/markets-pack/src/sources/fixture.adapter.spec.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { FixtureAdapter } from './fixture.adapter.js';
import { deriveHealth } from '@de-braighter/markets-source-spine';

describe('FixtureAdapter', () => {
  it('descriptor.id is coingecko-fixture', () => {
    expect(new FixtureAdapter().descriptor.id).toBe('coingecko-fixture');
  });

  it('returns ok:true with all three assets', async () => {
    const result = await new FixtureAdapter().fetch();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.payload['bitcoin']?.usd).toBe(67_000);
    expect(result.value.payload['ethereum']?.usd).toBe(3_500);
    expect(result.value.payload['cardano']?.usd).toBeCloseTo(0.45);
  });

  it('last_updated_at is recent so health is always online', async () => {
    const result = await new FixtureAdapter().fetch();
    if (!result.ok) throw new Error('unreachable');
    const adapter = new FixtureAdapter();
    const now = new Date().toISOString();
    const health = deriveHealth(
      result.value.provenance.fetchedAt,
      now,
      adapter.descriptor.latencyBudgetMs,
    );
    expect(health).toBe('online');
  });

  it('provenance.sourceId is coingecko-fixture', async () => {
    const result = await new FixtureAdapter().fetch();
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.provenance.sourceId).toBe('coingecko-fixture');
    expect(result.value.provenance.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: FAIL with `Cannot find module './fixture.adapter.js'`

- [ ] **Step 3: Write `fixture.adapter.ts`**

`libs/markets-pack/src/sources/fixture.adapter.ts`:
```typescript
import { captureProvenance } from '@de-braighter/markets-source-spine';
import type {
  SourceDescriptor,
  SourcePort,
  SourceResult,
} from '@de-braighter/markets-source-spine';
import type { CoinGeckoPricePayload } from './coingecko.adapter.js';

export class FixtureAdapter implements SourcePort<CoinGeckoPricePayload> {
  readonly descriptor: SourceDescriptor = {
    id: 'coingecko-fixture',
    name: 'CoinGecko fixture (recorded snapshot)',
    category: 'crypto-price',
    required: true,
    latencyBudgetMs: 120_000,
  };

  async fetch(): Promise<SourceResult<CoinGeckoPricePayload>> {
    // last_updated_at = 30 seconds ago → always 'online' against the latency budget
    const recentUnix = Math.floor(Date.now() / 1000) - 30;
    const payload: CoinGeckoPricePayload = {
      bitcoin:  { usd: 67_000, last_updated_at: recentUnix },
      ethereum: { usd: 3_500,  last_updated_at: recentUnix },
      cardano:  { usd: 0.45,   last_updated_at: recentUnix },
    };
    const provenance = captureProvenance('coingecko-fixture', payload);
    return { ok: true, value: { payload, provenance } };
  }
}
```

- [ ] **Step 4: Run the test — must PASS**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: 4 FixtureAdapter tests passed (12 total across all markets-pack tests).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/markets-pack/src/sources/fixture.adapter.ts libs/markets-pack/src/sources/fixture.adapter.spec.ts
git commit -m "feat(markets-pack): FixtureAdapter — deterministic snapshot for tests/CI

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: `observations.ts` (TDD)

**Files:**
- Create: `libs/markets-pack/src/observations.spec.ts`
- Create: `libs/markets-pack/src/observations.ts`

- [ ] **Step 1: Write the failing test**

`libs/markets-pack/src/observations.spec.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { toObservationEnvelopes } from './observations.js';
import type { SourceFetch } from '@de-braighter/markets-source-spine';
import type { CoinGeckoPricePayload } from './sources/coingecko.adapter.js';

const TENANT = '10000000-0000-4001-8000-000000000001';

const FETCH_RESULT: SourceFetch<CoinGeckoPricePayload> = {
  payload: {
    bitcoin:  { usd: 67_000, last_updated_at: 1_748_908_800 },
    ethereum: { usd: 3_500,  last_updated_at: 1_748_908_800 },
    cardano:  { usd: 0.45,   last_updated_at: 1_748_908_800 },
  },
  provenance: {
    sourceId: 'coingecko',
    fetchedAt: '2026-06-03T00:00:00.000Z',
    payloadHash: 'abc123',
  },
};

describe('toObservationEnvelopes', () => {
  it('emits exactly 3 envelopes — one per asset', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    expect(envelopes).toHaveLength(3);
  });

  it('each envelope has the correct event metadata', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    for (const env of envelopes) {
      expect(env.eventType).toBe('markets:PriceObservation.v1');
      expect(env.aggregateType).toBe('Asset');
      expect(env.tenantPackId).toBe(TENANT);
      expect(env.packId).toBe('markets');
      expect(env.eventVersion).toBe(1);
    }
  });

  it('bitcoin envelope has correct aggregateId', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    const btc = envelopes.find(e => e.payload['assetId'] === 'bitcoin');
    expect(btc).toBeDefined();
    expect(btc!.aggregateId).toBe('00000000-0001-4000-8000-000000000001');
  });

  it('ethereum envelope has correct aggregateId', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    const eth = envelopes.find(e => e.payload['assetId'] === 'ethereum');
    expect(eth!.aggregateId).toBe('00000000-0002-4000-8000-000000000002');
  });

  it('cardano envelope has correct aggregateId', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    const ada = envelopes.find(e => e.payload['assetId'] === 'cardano');
    expect(ada!.aggregateId).toBe('00000000-0003-4000-8000-000000000003');
  });

  it('payload contains priceUsd and lastUpdatedAt (ISO string)', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    const btc = envelopes.find(e => e.payload['assetId'] === 'bitcoin')!;
    expect(btc.payload['priceUsd']).toBe(67_000);
    expect(typeof btc.payload['lastUpdatedAt']).toBe('string');
    expect(() => new Date(btc.payload['lastUpdatedAt'] as string)).not.toThrow();
  });

  it('occurredAt matches provenance.fetchedAt', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    for (const env of envelopes) {
      expect(env.occurredAt).toBe('2026-06-03T00:00:00.000Z');
    }
  });

  it('metadata.actorRef is coingecko-adapter', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    for (const env of envelopes) {
      expect(env.metadata.actorRef).toBe('coingecko-adapter');
    }
  });

  it('metadata.provenance carries the source provenance', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    const btc = envelopes[0]!;
    expect((btc.metadata as Record<string, unknown>)['provenance']).toEqual(FETCH_RESULT.provenance);
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: FAIL with `Cannot find module './observations.js'`

- [ ] **Step 3: Write `observations.ts`**

`libs/markets-pack/src/observations.ts`:
```typescript
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts';
import type { SourceFetch } from '@de-braighter/markets-source-spine';
import { ASSET_IDS, PACK_ID, type AssetKey } from './constants.js';
import type { CoinGeckoPricePayload } from './sources/coingecko.adapter.js';

export function toObservationEnvelopes(
  tenantPackId: string,
  fetchResult: SourceFetch<CoinGeckoPricePayload>,
): DomainEventEnvelope[] {
  const envelopes: DomainEventEnvelope[] = [];

  for (const assetId of Object.keys(ASSET_IDS) as AssetKey[]) {
    const entry = fetchResult.payload[assetId];
    if (!entry) continue;

    envelopes.push({
      packId: PACK_ID,
      tenantPackId,
      eventType: 'markets:PriceObservation.v1',
      aggregateType: 'Asset',
      aggregateId: ASSET_IDS[assetId],
      eventVersion: 1,
      occurredAt: fetchResult.provenance.fetchedAt,
      payload: {
        assetId,
        priceUsd: entry.usd,
        lastUpdatedAt: new Date(entry.last_updated_at * 1000).toISOString(),
      },
      metadata: {
        actorRef: 'coingecko-adapter',
        provenance: fetchResult.provenance,
      },
    });
  }

  return envelopes;
}
```

- [ ] **Step 4: Run all markets-pack tests — must all PASS**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: all tests passed (1 + 7 + 4 + 8 = 20 total).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/markets-pack/src/observations.ts libs/markets-pack/src/observations.spec.ts
git commit -m "feat(markets-pack): toObservationEnvelopes — maps CoinGecko fetch to DomainEventEnvelope[]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Update `markets-pack/src/index.ts` + full workspace gate

**Files:**
- Modify: `libs/markets-pack/src/index.ts`

- [ ] **Step 1: Update `index.ts` to export the full Phase 2a public surface**

Replace the entire content of `libs/markets-pack/src/index.ts`:
```typescript
export type { SourcePort, SourceDescriptor, SourceResult } from '@de-braighter/markets-source-spine';
export { PACK_ID, ASSET_IDS, type AssetKey } from './constants.js';
export { CoinGeckoAdapter, type CoinGeckoPricePayload } from './sources/coingecko.adapter.js';
export { FixtureAdapter } from './sources/fixture.adapter.js';
export { toObservationEnvelopes } from './observations.js';
```

- [ ] **Step 2: Run all markets-pack tests — must still PASS**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: all tests passed.

- [ ] **Step 3: Build markets-pack**

```bash
pnpm run typecheck && pnpm run build
```
Expected: no errors.

- [ ] **Step 4: Run the full workspace gate**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run ci:local
```
Expected: build + typecheck + test all pass across all 3 packages.

- [ ] **Step 5: Verify git status is clean**

```bash
git status --short
```
Expected: only `M  libs/markets-pack/src/index.ts` staged; no dist/ or node_modules/ leaking.

- [ ] **Step 6: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/markets-pack/src/index.ts
git commit -m "feat(markets-pack): export Phase 2a public surface

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Open Phase 2a PR

- [ ] **Step 1: Push the branch to origin**

```bash
cd D:/development/projects/de-braighter/domains/markets
git push -u origin main
```
(Phase 2a commits are already on `main` in `de-braighter/markets` — just push.)

OR if working on a feature branch, push that and open a PR to `de-braighter/markets` main.

- [ ] **Step 2: Verify the gate is green on GitHub**

The `de-braighter/markets` repo has no CI configured yet (billing frozen). Confirm locally that `pnpm run ci:local` passes, then note this in the PR description.

- [ ] **Step 3: If using a branch, merge it**

After confirming green locally, squash-merge to main. Note for the twin ritual: `drain markets#<PR>` + `backfill` + `reconcile` from `domains/devloop`.

---

## Self-Review

**Spec coverage:**
- `captureProvenance` → Task 1 ✓
- `deriveHealth` → Task 2 ✓
- `confidence-gate` → Task 3 ✓
- source-spine index re-exports → Task 4 ✓
- `CoinGeckoAdapter` (real fetch, error cases) → Task 6 ✓
- `FixtureAdapter` (snapshot, always online) → Task 7 ✓
- `toObservationEnvelopes` (3 assets, stable IDs, correct shape) → Task 8 ✓
- substrate-contracts dep in markets-pack → Task 5 ✓
- Full workspace gate green → Task 9 ✓

**Placeholder scan:** None found.

**Type consistency:**
- `CoinGeckoPricePayload` defined in Task 6, imported in Tasks 7, 8 ✓
- `PACK_ID` + `ASSET_IDS` + `AssetKey` defined in Task 5 (`constants.ts`), imported in Task 8 ✓
- `captureProvenance` defined in Task 1, imported in Tasks 6, 7 ✓
- `DomainEventEnvelope` from `@de-braighter/substrate-contracts` — no new definition needed ✓
