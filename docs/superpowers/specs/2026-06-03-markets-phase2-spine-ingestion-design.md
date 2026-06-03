---
title: "Markets domain — Phase 2: source spine + persisted ingestion (design)"
status: approved
kind: technical-design
created: 2026-06-03
author: stibe
home: domains/markets
relates-to:
  - docs/superpowers/specs/2026-06-03-markets-external-source-integration-design.md
  - layers/specs/adr/adr-027-pack-architecture.md
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
---

# Markets Phase 2 — source spine + persisted ingestion

> Phase 1 locked the `SourcePort` contract and proved the workspace gate. Phase 2
> makes it real: three assets fetched from CoinGecko every 30 seconds, each price
> observation persisted to `kernel.event_log` as a `DomainEventEnvelope`, source
> health tracked, confidence capped when the feed goes stale.

## Decisions

| # | Decision |
|---|----------|
| D1 | **Two sub-phases**: 2a (pure functions + adapters, no DB) then 2b (DB + wiring) — each gets its own PR, each is green before the next opens |
| D2 | **Assets**: `bitcoin`, `ethereum`, `cardano` — three assets, hardcoded for Phase 2 |
| D3 | **Ingestion trigger**: both `@Interval(30_000)` auto-poll + `POST /ingest` manual override |
| D4 | **DB posture**: full substrate DB — real `kernel.event_log` via `PrismaOutboxWriter`, `GucPrismaRunner`, Postgres 16 on port 5455 |
| D5 | **Auth posture**: in-memory (`InMemoryPackRoleAssignmentRepository` + `InMemoryConsentReceiptRepository`) — same demo mode as herdbook Phase 1 |
| D6 | **`aggregateId`**: stable hardcoded UUIDs per asset (no `uuid` library dep in Phase 2) |
| D7 | **Confidence**: Phase 2 has no real posterior — confidence is binary: 1.0 (online) or 0.0 (stale/offline + required) |

## Phase 2a — pure spine + adapters

### Source spine additions (`libs/source-spine/src/`)

Three pure functions added alongside the existing `SourcePort` contract. All
re-exported from `index.ts`. No new dependencies — `node:crypto` is built-in.

**`provenance.ts`** — `captureProvenance(sourceId, raw): Provenance`

```typescript
// sha256 hex of JSON.stringify(raw); fetchedAt = new Date().toISOString()
export function captureProvenance(sourceId: string, raw: unknown): Provenance
```

Deterministic given the same input. The hash is the audit trail — lets a reader
verify the raw payload hasn't drifted from what was logged.

**`source-health.ts`** — `deriveHealth(fetchedAt, now, latencyBudgetMs): SourceHealthStatus`

```
delta = Date.parse(now) - Date.parse(fetchedAt)
delta < budget         → 'online'
delta < budget × 3     → 'stale'
else                   → 'offline'
```

The × 3 stale window gives one full budget worth of grace for transient blips
before confidence is capped.

**`confidence-gate.ts`** — `capConfidence(raw, health, required): number`

```
required && health !== 'online'  → 0.0
otherwise                        → raw
```

Phase 3 passes a real posterior through this gate. Phase 2 calls it with `raw = 1.0`.

### Markets-pack additions (`libs/markets-pack/src/`)

**`CoinGeckoPricePayload`** type:

```typescript
type CoinGeckoPricePayload = Record<string, {
  usd: number;
  last_updated_at: number; // unix seconds
}>;
```

**`sources/coingecko.adapter.ts`** — `CoinGeckoAdapter implements SourcePort<CoinGeckoPricePayload>`

- Descriptor: `id:'coingecko'`, `required:true`, `latencyBudgetMs:120_000`
- `fetch()` calls `globalThis.fetch` (Node 18+ native, no extra dep):
  ```
  https://api.coingecko.com/api/v3/simple/price
    ?ids=bitcoin,ethereum,cardano
    &vs_currencies=usd
    &include_last_updated_at=true
  ```
- HTTP 429 → `kind:'rate-limited'`; network error → `kind:'unreachable'`; missing
  asset keys in response → `kind:'bad-shape'`
- On success: calls `captureProvenance('coingecko', raw)` and returns `ok:true`

**`sources/fixture.adapter.ts`** — `FixtureAdapter implements SourcePort<CoinGeckoPricePayload>`

Hardcoded snapshot (BTC ~67000, ETH ~3500, ADA ~0.45). `last_updated_at` = `Math.floor(Date.now() / 1000) - 30` so it is always 'online'. Used in all unit tests and CI — zero network calls.

**`observations.ts`** — `toObservationEnvelopes(tenantPackId, fetchResult): DomainEventEnvelope[]`

One envelope per asset. Stable aggregate IDs:

| Asset | aggregateId |
|-------|-------------|
| bitcoin | `00000000-0001-4000-8000-000000000001` |
| ethereum | `00000000-0002-4000-8000-000000000002` |
| cardano | `00000000-0003-4000-8000-000000000003` |

```typescript
{
  packId: PACK_ID,                       // 'markets'
  tenantPackId,
  eventType: 'markets:PriceObservation.v1',
  aggregateType: 'Asset',
  aggregateId: ASSET_IDS[assetId],
  eventVersion: 1,
  occurredAt: fetchResult.provenance.fetchedAt,
  payload: {
    assetId,                             // 'bitcoin' | 'ethereum' | 'cardano'
    priceUsd: entry.usd,
    lastUpdatedAt: new Date(entry.last_updated_at * 1000).toISOString(),
  },
  metadata: {
    actorRef: 'coingecko-adapter',
    provenance: fetchResult.provenance,  // { sourceId, fetchedAt, payloadHash }
  },
}
```

---

## Phase 2b — DB foundation + wiring

### Docker + DB setup

**`docker-compose.yml`** at repo root:

```yaml
services:
  markets-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: markets
    ports:
      - "5455:5432"
    volumes:
      - markets-db-data:/var/lib/postgresql/data
volumes:
  markets-db-data:
```

**`db/app-roles.sql`** — provisions the `app` non-superuser role (idempotent):

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app WITH LOGIN PASSWORD 'app'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
```

**`db:setup` script** (`package.json`):
1. `docker compose up -d markets-db` + wait for ready
2. Run `db/app-roles.sql` via `psql` (admin URL)
3. Run substrate-runtime's published SQL scripts (kernel schema + RLS + grants) —
   copy the pattern from herdbook's `tmp/` SQL files, which are derived from the
   substrate-runtime package exports
4. `prisma migrate deploy` (no pack migrations in Phase 2 — schema is kernel-only)

**Environment variables** (`.env`, gitignored):

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5455/markets
SUBSTRATE_APP_DATABASE_URL=postgresql://app:app@localhost:5455/markets
MARKETS_TENANT_PACK_ID=10000000-0000-4000-8000-000000000001
```

### Prisma schema (`apps/markets-api/prisma/schema.prisma`)

Phase 2 has no pack-specific tables. The schema declares the DB connection and
generators only — `PrismaOutboxWriter` writes to `kernel.event_log` via raw SQL
inside the GUC-scoped transaction, so no Prisma model is needed for the event log.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Demo tenant + manifest (`apps/markets-api/src/config/`)

**`tenants.ts`**:
```typescript
export const MARKETS_TENANT_PACK_ID = process.env['MARKETS_TENANT_PACK_ID']
  ?? '10000000-0000-4000-8000-000000000001';

export const MARKETS_TENANTS: readonly TenantDescriptor[] = [
  { tenantPackId: MARKETS_TENANT_PACK_ID, packKey: PACK_ID },
];
```

**`manifest.ts`** — minimal `PackManifest`:
```typescript
export const MARKETS_MANIFEST: PackManifest = {
  packId: PACK_ID,
  roles: [],
  permissions: [],
  consentPurposes: [],
};
```

### `PriceIngestionService` (`apps/markets-api/src/ingestion/`)

```typescript
@Injectable()
export class PriceIngestionService {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    private readonly runner: GucPrismaRunner,
    private readonly adapter: CoinGeckoAdapter,
  ) {}

  async ingest(): Promise<IngestionResult> {
    const result = await this.adapter.fetch();
    const now = new Date().toISOString();

    if (!result.ok) {
      return { observed: 0, health: 'offline', confidence: 0, error: result.error };
    }

    const health = deriveHealth(result.value.provenance.fetchedAt, now,
                                this.adapter.descriptor.latencyBudgetMs);
    const confidence = capConfidence(1.0, health, this.adapter.descriptor.required);
    const envelopes = toObservationEnvelopes(MARKETS_TENANT_PACK_ID, result.value);

    await this.runner.run(MARKETS_TENANT_PACK_ID,
      (tx) => this.publisher.publishAll(envelopes, tx));

    return { observed: envelopes.length, health, confidence };
  }

  @Interval(30_000)
  async scheduledIngest(): Promise<void> {
    try {
      const r = await this.ingest();
      // structured log — no console.log
      this.logger.log({ event: 'ingestion.tick', ...r });
    } catch (err) {
      this.logger.error({ event: 'ingestion.tick.error', err });
    }
  }
}
```

`scheduledIngest()` never throws — a transient CoinGecko error logs and the 30 s
interval continues uninterrupted.

### `IngestionController` (`POST /ingest`)

```typescript
@Controller('ingest')
export class IngestionController {
  @Post()
  async ingest(): Promise<IngestionResult> {
    return this.service.ingest();
  }
}
```

### `AppModule` updates

```typescript
// Constructed once at module load — the RLS-scoped non-superuser role.
const appRoleClient = new PrismaClient({
  datasources: { db: { url: process.env['SUBSTRATE_APP_DATABASE_URL'] } },
});

SubstrateModule.forRoot({
  tenants: MARKETS_TENANTS,
  manifests: [MARKETS_MANIFEST],
  prismaClient: appRoleClient,          // ← binds DOMAIN_EVENT_PUBLISHER → PrismaOutboxWriter
  packRoleAssignmentRepository: InMemoryPackRoleAssignmentRepository,
  consentReceiptRepository: InMemoryConsentReceiptRepository,
}),
ScheduleModule.forRoot(),
```

`prismaClient` is required even though we use in-memory auth repos — without it
`SubstrateModule` defaults to `InMemoryDomainEventPublisher` and observations never
reach `kernel.event_log`. The split posture (real publisher + in-memory auth) is
intentional: Phase 2 proves persisted ingestion; DB-backed auth is a Phase 3+ concern.

`GucPrismaRunner` is provided as a value provider:
```typescript
{ provide: GucPrismaRunner, useValue: new GucPrismaRunner(appRoleClient) }
```

New providers: `PriceIngestionService`, `IngestionController`, `CoinGeckoAdapter`,
`GucPrismaRunner` (value provider wrapping the app-role client).

---

## Live-verify target

```bash
# Start DB + seed
docker compose up -d && npm run db:setup

# Start API
npm run start

# Trigger ingestion manually
curl -s -X POST http://localhost:3300/ingest
# → {"observed":3,"health":"online","confidence":1}

# Confirm rows in kernel.event_log
psql $DATABASE_URL -c "SELECT aggregate_id, payload->>'assetId', payload->>'priceUsd'
                       FROM kernel.event_log
                       WHERE event_type = 'markets:PriceObservation.v1'
                       ORDER BY occurred_at DESC LIMIT 6;"
```

Expected: 3 rows per ingestion cycle, one per asset (bitcoin / ethereum / cardano).

---

## New dependencies (Phase 2)

| Package | Where | Why |
|---------|-------|-----|
| `@de-braighter/substrate-contracts` | markets-pack | `DomainEventEnvelope` type |
| `@de-braighter/substrate-runtime` | markets-api | `SubstrateModule`, `GucPrismaRunner`, `PrismaOutboxWriter`, in-memory stubs |
| `@nestjs/schedule` | markets-api | `@Interval` scheduler |
| `@prisma/client` | markets-api | DB client for `GucPrismaRunner` |
| `prisma` (dev) | markets-api | schema + migrations CLI |

No new deps in `libs/source-spine/` (uses `node:crypto` built-in).

---

## What Phase 2 does NOT include

- Real inference / posterior computation → Phase 3
- `GET /readout` endpoint → Phase 3
- Angular UI → Phase 3
- Configurable asset list (env-driven) → Phase 3 or later
- Pack-specific Prisma tables → Phase 3 (projections for the readout)
- Scheduled task configuration (interval as env var) → Phase 3
