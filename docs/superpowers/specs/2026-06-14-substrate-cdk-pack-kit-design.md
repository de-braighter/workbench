# Substrate Composition Kit (`substrate-runtime/kit`) — design spec

- **Date:** 2026-06-14
- **Status:** Design — approved in brainstorm, pending spec review
- **Program:** Phase 1 of the Substrate DX "Paved Road" program (`docs/superpowers/plans/2026-06-14-substrate-dx-paved-road-program.md`)
- **Reference product:** `domains/exercir` → `pack-kids-football` (+ one inference product — e.g. `gridiron` — for the `inferenceBackboneProviders` swap)

## Motivation

There is no layer between the substrate primitives (`@de-braighter/substrate-{contracts,runtime}`) and a product's composition root, so every product re-pays the same ~600 LOC of boot-time wiring and re-exposes the same footguns. A production pack is ~82 files / ~10.7K LOC, ~70% mechanical template. This spec defines a thin, boot-time **composition kit** that collapses the repeated wiring into a handful of typed helpers, validated against a real consumer.

## Decisions (from brainstorm)

1. **Home — subpath of the runtime: `@de-braighter/substrate-runtime/kit`.** Not a third package. Rationale: unlike `contracts` (dependency-free, consumed by non-Nest code → earns its own package), the kit is NestJS-coupled and wires runtime internals, so it belongs *with* the runtime. A subpath keeps the "convenience vs. primitive" boundary legible in every import without adding a third package to the contracts↔runtime version lockstep.
2. **Scope — all five helpers; two real consumers.** Migrate `pack-kids-football` fully (validates four helpers) **and** swap one existing inference product's provider-array (~20 lines) onto `inferenceBackboneProviders` — preferably one that wires the optional `distributionCatalog` (e.g. `gridiron`) so the swap exercises the fullest form of the helper, validating the fifth against real code + its existing tests. Every helper is born from a real consumer, never abstracted from memory.
3. **Ergonomics — E1: plain factory functions returning provider arrays**, over one shared `ModuleFragment` currency, plus a thin optional `packPreset()` composer for the common case. Decisive factor: the primary builders are foundry agents, and explicit functions + `...spread` are far more reliable for an agent to emit and edit than a fluent builder's chained state or a god-config object. The one exception is the auth bootstrap (a base class — it needs injected deps + a lifecycle hook).

## Architecture

A new `src/kit/` barrel in `layers/substrate/libs/substrate-runtime`, exposed through an `exports` entry as `@de-braighter/substrate-runtime/kit`. Every helper composes **existing** runtime primitives (`SubstrateModule`, `GucPrismaRunner`, the in-memory repos, `PolicyEngine`, `ConsentEngine`, the inference providers) into NestJS provider arrays.

**Charter stance (preempting charter-checker):** the kit authors **no** kernel concept, adds **no** persistence, introduces **no** new request-path code. It is pure Ring-4/5 boot-time assembly sugar that *composes* primitives — the sanctioned pack posture. The four kernel concerns are untouched; ADR-176 minimality is unaffected (complexity moves *up*, out of every product, into one optional convenience layer).

## Components

The shared currency is a spreadable module fragment:

```ts
interface ModuleFragment {
  imports?: (Type | DynamicModule)[];
  providers?: Provider[];
  controllers?: Type[];
}
```

### 1 — `packPreset` (common-case composer)

```ts
function packPreset(opts: {
  manifests: PackManifest[];
  tenantRegistry: TenantRegistry;
  packRoleAssignmentRepository?: Type;   // default: InMemoryPackRoleAssignmentRepository
  consentReceiptRepository?: Type;       // default: InMemoryConsentReceiptRepository
}): ModuleFragment;
```

Wraps `SubstrateModule.forRoot({...})` and binds the standard in-memory fallback repos. Returns `{ imports: [SubstrateModule.forRoot(...)], providers: [...] }`.

### 2 — `dbAuthWiring` (managed client + null-pattern + conditional DB module)

```ts
function dbAuthWiring<C extends { $disconnect(): Promise<void> }>(opts: {
  flag: string;                         // env flag, e.g. 'PACK_KIDS_FOOTBALL_DB'
  createClient: (url: string) => C;     // app supplies — news up ITS PrismaClient
  dbModule: { forRoot(client: C): DynamicModule };
  url?: string;                         // env var name; default 'SUBSTRATE_APP_DATABASE_URL'
  requireRls?: boolean;                 // default true: enforce SUBSTRATE_RLS_ENABLED=true
}): { client: C | null; fragment: ModuleFragment };
```

The kit lives in `substrate-runtime`, which has no app Prisma schema, so it **cannot `extends PrismaClient`** itself — the app passes a `createClient` factory; the kit wraps lifecycle via a `DbAuthClientDisposer` provider (`$disconnect` on destroy) and binds the client under a `DB_AUTH_CLIENT` token. Centralizes the flag-gate + conditional `dbModule.forRoot(client)` mount (kids-football `app.module.ts` L44–79). **Fails loud at boot** with named errors if the flag is on but the URL env is unset, or if `SUBSTRATE_RLS_ENABLED` isn't `true` (the safety the audit asked for).

### 3 — `inferenceBackboneProviders` (the identical 5-provider chain)

```ts
function inferenceBackboneProviders(opts: {
  catalog: InferenceCatalog;            // closed over (useValue)
  runner: GucPrismaRunner;              // closed over by the evidence repo
  withDistributionCatalog?: boolean;    // default false (markets shape); true = gridiron (5-arg router)
  members?: MemberResolution;           // default: createNullMemberResolution('inference')
  sidecar?: unknown;                    // default: null
}): Provider[];
```

Emits the chain that is line-for-line identical across gridiron/markets: `INFERENCE_CATALOG` → evidence repository (`PrismaEvidenceLogRepository` over the closed-over `runner`) → `NUMPYRO_SIDECAR` → `MEMBER_RESOLUTION_PORT` → `INFERENCE_BACKBONE` factory. The only cross-product difference is whether `DISTRIBUTION_CATALOG` joins the router's `inject` (gridiron yes, markets no) — hence `withDistributionCatalog`. Also exports `createNullMemberResolution(label)` to replace the per-app `NULL_MEMBER_RESOLUTION` stub. Does **not** cover pack-football's bespoke helper (flag-gated in-memory evidence + pack-private runner token + optional run-recorder) — that stays as-is.

### 4 — `selectAdapter` (the simple symmetric fork)

```ts
function selectAdapter<T>(
  useDb: boolean,
  token: symbol,
  prismaImpl: Type<T>,
  inMemoryImpl: Type<T>,
): Provider;   // { provide: token, useClass: useDb ? prismaImpl : inMemoryImpl }
```

The simple symmetric `useClass` fork (the herdbook/markets-shaped pattern). **kids-football's repos use a request-scoped store-map pattern that is NOT symmetric**, so the kids-football migration does not route its repos through `selectAdapter` — those keep their existing wiring. `selectAdapter` ships unit-tested and is adopted by symmetric-pattern products opportunistically.

### 5 — `AuthBootstrapBase` (the one base class)

```ts
interface DemoGrant { tenantId: string; userId: string; roleId: string; }

abstract class AuthBootstrapBase implements OnApplicationBootstrap {
  protected abstract readonly controllers: readonly Type[];
  protected abstract readonly packKey: string;
  protected abstract readonly demoGrants: readonly DemoGrant[];   // declarative, no logic
  protected async seedDemoData(): Promise<void> {}                // override hook for pack-data seeds
  // injects PolicyEngine + PACK_ROLE_ASSIGNMENT_REPOSITORY + TENANT_REGISTRY (NO ConsentEngine);
  // owns collectDecoratorPermissionIds + validateDecoratorReferences + idempotent grant seed
}
```

The one inheritance point in the kit, justified because it needs injected deps + a NestJS lifecycle hook (template-method, not builder). The pack's subclass becomes ~declaration-only (controllers + packKey + demoGrants, plus a `seedDemoData()` override for pack-data), collapsing `pack-kids-football-auth.bootstrap.ts` from ~356 LOC. **Note:** the real bootstrap does no consent seeding (consent receipts are bound declaratively in `forRoot`); the base reflects that.

## The win, concretely (honest)

`pack-kids-football`'s `app.module.ts` is already lean (82 lines) and barely shrinks; its real win is **`pack-kids-football-auth.bootstrap.ts` ~356 → ~30 lines** plus pattern uniformity. The dramatic ~600-LOC/product reduction lands hardest on the **inference-wiring products** (gridiron/markets/agri) and the auth bootstrap — which is why the scope-A inference swap is doing real validation work, not ceremony.

## Data flow & error handling

All helpers run at **module-definition time** (pure → providers) or at **`onApplicationBootstrap`** (the auth seed). Nothing runs per-request → no perf/ε-budget impact, no charter concern. Helpers **fail loud at boot** with named, actionable errors; never silently no-op.

## Testing

- **Per-helper unit tests:** options → expected `ModuleFragment` / `Provider[]` shape (including default-fallback behavior).
- **Behavioral parity (the real proof):** `pack-kids-football`'s existing API + unit tests stay green through the migration (it is a refactor, not a behavior change); the swapped inference product's existing inference tests stay green.
- **Verifier wave:** reviewer + qa-engineer + local-ci, plus **charter-checker** (confirm composition stance) and **exercir-charter-checker** (the `domains/exercir` PR).

## Migration & rollout

Purely **additive + opt-in**. New exports only; no existing product changes except (a) `pack-kids-football` migrated, (b) one inference product's provider-array swapped. All other products are untouched and adopt the kit on their next composition-root touch.

## Scope guards (kept out of Phase 1, on purpose)

- Typed DI (`definePort` / `bindPort`) → **Phase 2.** The kit uses today's Symbol tokens for now.
- `Result` combinators + error model → **Phase 3.**
- Lint preset + boot-asserts → **Phase 4.**
- Domain code templates → **Phase 5.**

The kit must not absorb these — the phases stay clean.

## Deliverables

1. `src/kit/` implementation in `layers/substrate/libs/substrate-runtime` + the `@de-braighter/substrate-runtime/kit` `exports` entry.
2. Per-helper unit tests.
3. A new published runtime version; `domains/exercir` bumped to consume it.
4. `pack-kids-football` migrated onto the kit (app.module + auth bootstrap); one inference product's provider-array swapped.
5. An ADR (substrate-architect) recording the subpath-kit decision + charter stance, citing this spec.

## Exit criteria

- `pack-kids-football` builds + tests green on the kit; auth bootstrap collapsed to ~declaration-only.
- One inference product green on `inferenceBackboneProviders`.
- charter-checker confirms "composes, not authors."
- Net composition-root + auth-bootstrap LOC down materially on the migrated product(s).
