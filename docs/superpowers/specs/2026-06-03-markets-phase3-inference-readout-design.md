---
title: "Markets domain — Phase 3: inference backbone + readout (design)"
status: approved
kind: technical-design
created: 2026-06-03
author: stibe
home: domains/markets
relates-to:
  - docs/superpowers/specs/2026-06-03-markets-external-source-integration-design.md
  - docs/superpowers/specs/2026-06-03-markets-phase2-spine-ingestion-design.md
  - layers/specs/adr/adr-203-wire-inference-to-observation-log-and-second-conjugate-family.md
  - layers/specs/adr/adr-165-inference-backbone-port.md
---

# Markets Phase 3 — inference backbone + readout

> Phase 2 proved that real prices land in `kernel.event_log`. Phase 3 makes the
> substrate *compute* from them: a Normal-Normal posterior over log-prices for
> BTC, ETH, and ADA, a `GET /readout` endpoint that exponentates back to price
> space, and an Angular UI that renders the three posteriors as live asset cards.

## Decisions

| # | Decision |
|---|----------|
| D1 | **Two sub-phases**: 3a (inference backend + `GET /readout`) then 3b (Angular UI) — 3a verifiable with `curl` before touching Angular |
| D2 | **Log-price indicator** `markets.log_price` — store `logPriceUsd = Math.log(priceUsd)` in the observation payload; `ObservationProjection.numeratorPath` points to it; `readout` exponentiates back to price space |
| D3 | **`kind: 'person'` subject workaround** — the Normal-Normal fast-path rejects non-`person` subjects; assets are represented as `{ kind: 'person', id: ASSET_IDS[assetId] }` using the stable Phase 2 UUIDs; the `aggregate_id = subject.id` filter is the backbone's only use of the id; a comment marks the workaround for when a `world`/`asset` kind adapter ships |
| D4 | **Shared indicator, three subjects** — one `markets.log_price` catalog entry; three `posterior()` calls with different subjects; no per-asset prior tuning needed (prior `priorMean:4, priorSd:5` is effectively flat for all three in log-space) |
| D5 | **Degenerate plan tree root** seeded via `tools/db/seed.mjs` (separate from `db:setup`); stable `MARKETS_PLAN_ROOT_ID`; idempotent `ON CONFLICT DO NOTHING` |
| D6 | **Angular CLI standalone** on port 4300, `proxy.conf.json` to `:3300`, design tokens from a copied `tokens.css`, no Nx, no npm dep on `@de-braighter/design-system` |
| D7 | **Geometric mean label** in the UI — `exp(posterior.mean)` is the geometric mean of price, not arithmetic; the UI labels it accurately |

---

## Phase 3a — inference backend + `GET /readout`

### §1 — Observation update (`libs/markets-pack/src/observations.ts`)

Add `logPriceUsd: Math.log(entry.usd)` to the existing payload alongside `priceUsd`:

```typescript
payload: {
  assetId,
  priceUsd: entry.usd,
  logPriceUsd: Math.log(entry.usd),          // ← new: numeratorPath target
  lastUpdatedAt: new Date(entry.last_updated_at * 1000).toISOString(),
},
```

Backwards-compatible additive change — all existing tests still pass. One new assertion in `observations.spec.ts` verifies `logPriceUsd === Math.log(priceUsd)`.

### §2 — DB foundation: `kernel.plan_node` + seed

**`db:setup` update** — add `kernel-plan-tree.sql` as step 4 in `tools/db/setup.mjs`:
```javascript
execFile('kernel-plan-tree', 'kernel-plan-tree.sql');
```

**`tools/db/seed.mjs`** — new script, inserts the degenerate plan tree root via
`prisma.$executeRawUnsafe` inside a `GucPrismaRunner.run(tenantPackId, tx => ...)`
call so the RLS GUC is set before the INSERT:

```javascript
// Idempotent INSERT via raw SQL (ON CONFLICT DO NOTHING)
await runner.run(MARKETS_TENANT_PACK_ID, async (tx) => {
  await tx.$executeRawUnsafe(`
    INSERT INTO kernel.plan_node (id, tenant_pack_id, parent_id, type, ordinal, effects)
    VALUES ($1, $2, NULL, 'markets.world', 0, '[]'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, MARKETS_PLAN_ROOT_ID, MARKETS_TENANT_PACK_ID);
});
```

The seed.mjs file resolves `GucPrismaRunner` and `PrismaClient` from the installed
`@de-braighter/substrate-runtime` package (same `createRequire` pattern as `setup.mjs`).
It reads `.env` via `env.mjs` for `SUBSTRATE_APP_DATABASE_URL`.

**`apps/markets-api/src/config/tenants.ts`** — add:
```typescript
export const MARKETS_PLAN_ROOT_ID = '20000000-0000-4000-8000-000000000001' as const;
```

**Root `package.json`** — add `db:seed` script; update `ci:local:db`:
```json
"db:seed":    "node tools/db/seed.mjs",
"ci:local:db": "pnpm run db:start && pnpm run db:setup && pnpm run db:seed && pnpm run ci:local"
```

### §3 — `InferenceCatalog` registration (`libs/markets-pack/src/inference/`)

New folder `libs/markets-pack/src/inference/`:

**`inference-catalog.ts`**:
```typescript
import { InMemoryInferenceCatalog } from '@de-braighter/substrate-runtime';
import type { ObservationProjection } from '@de-braighter/substrate-contracts/inference';
import { path } from '@de-braighter/substrate-contracts/inference';

export const MARKETS_LOG_PRICE_KEY = 'markets.log_price' as const;

export const MARKETS_LOG_PRICE_PROJECTION: ObservationProjection = {
  indicatorKey: MARKETS_LOG_PRICE_KEY,
  source: 'event-log',
  eventTypes: ['markets:PriceObservation.v1'],
  numeratorPath: path('logPriceUsd'),
  timestampPath: path('lastUpdatedAt'),
};

export function buildMarketsCatalog(): InMemoryInferenceCatalog {
  return new InMemoryInferenceCatalog([{
    indicatorKey: MARKETS_LOG_PRICE_KEY,
    conjugateHint: 'normal',
    priorMean: 4,      // log-scale: e^4 ≈ $54 — broad centre between ADA and BTC
    priorSd: 5,        // log-scale: covers ~$0.002–$1.2M — effectively flat prior
    observationSd: 2,  // broad noise model in log-space
    observationProjection: MARKETS_LOG_PRICE_PROJECTION,
  }]);
}
```

**`libs/markets-pack/src/index.ts`** — add exports:
```typescript
export { buildMarketsCatalog, MARKETS_LOG_PRICE_KEY, MARKETS_LOG_PRICE_PROJECTION }
  from './inference/inference-catalog.js';
```

### §4 — `AppModule` inference wiring

**`SubstrateModule.forRoot`** — add `inferenceCatalog`:
```typescript
SubstrateModule.forRoot({
  tenants: MARKETS_TENANTS,
  manifests: [MARKETS_MANIFEST],
  prismaClient: appRoleClient,
  inferenceCatalog: buildMarketsCatalog(),     // ← new
  packRoleAssignmentRepository: InMemoryPackRoleAssignmentRepository,
  consentReceiptRepository: InMemoryConsentReceiptRepository,
})
```

**`INFERENCE_BACKBONE` provider** — before writing code, verify in the installed
`apps/markets-api/node_modules/@de-braighter/substrate-runtime/dist/index.d.ts`:
(a) whether `INFERENCE_BACKBONE` token is re-exported from the runtime barrel,
(b) whether `SubstrateModule.forRoot({ inferenceCatalog })` auto-binds it to
`InMemoryInferenceBackbone` (the exercir `inference-backbone.providers.ts` pattern
suggests it does — check before adding an explicit provider as in Phase 2).

### §5 — `ReadoutService` + `GET /readout`

**`apps/markets-api/src/readout/readout.service.ts`**:

```typescript
export interface AssetReadout {
  readonly assetId: string;
  readonly meanPriceUsd: number;    // exp(posterior.mean) — geometric mean
  readonly p10PriceUsd: number;     // exp(posterior.p10)
  readonly p90PriceUsd: number;     // exp(posterior.p90)
  readonly observationCount?: number;  // from PosteriorHandle if available; omitted if not
  readonly health: SourceHealthStatus;
  readonly confidence: number;
  readonly error?: string;
}

export interface ReadoutResult {
  readonly assets: readonly AssetReadout[];
  readonly readoutAt: string;       // ISO 8601
}
```

`ReadoutService.readout()` calls `INFERENCE_BACKBONE.posterior()` for each of the three assets in `Promise.all()`. Uses `{ kind: 'person', id: ASSET_IDS[assetId] }` as the subject — the `kind: 'person'` is the v1 fast-path workaround (see D3). Exponentiates `summary.mean`, `summary.p10`, `summary.p90` back to price space.

**`PriceIngestionService`** — exposes `lastResult: IngestionResult | null` as a public getter, updated on each `ingest()` call. `ReadoutService` reads it for the `health` and `confidence` fields without re-fetching.

**`ReadoutController`** (`GET /readout`) — returns `ReadoutResult` JSON. No auth.

**Tests**: `ReadoutService` spec mocks `INFERENCE_BACKBONE` (returning a known `PosteriorHandle` with `summary.mean=11.1` for BTC, verifying `exp(11.1) ≈ 66686`). `ReadoutController` spec mocks the service.

### Live-verify target (Phase 3a)

```bash
curl -s http://localhost:3300/readout | jq .
```
Expected:
```json
{
  "assets": [
    { "assetId": "bitcoin",  "meanPriceUsd": 66724, "p10PriceUsd": ..., "p90PriceUsd": ..., "health": "online", "confidence": 1 },
    { "assetId": "ethereum", "meanPriceUsd": 1853,  ... },
    { "assetId": "cardano",  "meanPriceUsd": 0.21,  ... }
  ],
  "readoutAt": "2026-06-03T..."
}
```

---

## Phase 3b — Angular readout UI

### §6 — App scaffold (`apps/markets-ui/`)

Angular CLI standalone app on port **4300**:
```bash
ng new markets-ui --standalone --no-routing --style=css --skip-tests=false
```

`pnpm-workspace.yaml` already covers `apps/*` — no change needed.

**`proxy.conf.json`**:
```json
{ "/api": { "target": "http://localhost:3300", "pathRewrite": { "^/api": "" }, "changeOrigin": true } }
```

**`angular.json`** dev-server options: `"proxyConfig": "proxy.conf.json"`.

**CORS** (`apps/markets-api/src/main.ts`): `app.enableCors({ origin: 'http://localhost:4300' })`.

### §7 — Component structure

```
app/
  app.component.ts          ← shell: polls GET /api/readout every 10s + Ingest button
  asset-card/
    asset-card.component.ts ← @Input() asset: AssetReadout
    asset-card.component.css
  readout.service.ts        ← HttpClient wrapper
  readout.types.ts          ← AssetReadout + ReadoutResult interfaces (mirrors API)
```

**`AppComponent`**: uses `inject(ReadoutService)` + `toSignal(interval(10_000).pipe(switchMap(() => service.readout())))` for live updates. Shows last fetch time. A `POST /api/ingest` button triggers a manual ingestion cycle.

### §8 — Asset card design

Three cards using de-braighter design tokens (copied `tokens.css` as `src/tokens.css`, imported in `styles.css`):

- **BTC** → `--color-cyan` accent
- **ETH** → `--color-violet` accent
- **ADA** → `--color-mint` accent

Each card shows:
| Field | Value |
|-------|-------|
| Asset name + ticker | Bitcoin (BTC) |
| Geometric mean estimate | `$66,724` |
| 80% CI | `[$45,200 – $98,600]` |
| Health badge | `online` / `stale` / `offline` (colour-coded) |
| Confidence bar | thin progress bar 0–1 |
| Observation count | `24 observations` |

Glass panel style: `background: var(--glass-bg); backdrop-filter: blur(12px); border: 1px solid var(--glass-border);`.

Note in UI: labels the mean as "Geometric mean estimate (log-Normal posterior)" on hover/tooltip — accurate, not misleading.

---

## New dependencies (Phase 3)

| Package | Where | Why |
|---------|-------|-----|
| `@de-braighter/substrate-contracts/inference` | markets-pack | `ObservationProjection`, `path()`, `INFERENCE_BACKBONE` |
| `@de-braighter/substrate-runtime` | markets-pack (already in api) | `InMemoryInferenceCatalog` |
| `@angular/core` et al. | markets-ui (new app) | Angular standalone |
| `@angular/common/http` | markets-ui | `HttpClient` for readout polling |

---

## What Phase 3 does NOT include

- Real inference adapter beyond Normal-Normal conjugate (NumPyro sidecar → deferred)
- Per-asset prior tuning (D4: shared flat prior is sufficient for a demonstrator)
- Auth on `GET /readout` → Phase 4+
- Asset configuration via env var → Phase 4+
- The `/new-domain` scaffolder skill extraction → after Phase 3 ships (reference run complete)
