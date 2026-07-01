# Substrate Composition Kit (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a boot-time composition kit as the `@de-braighter/substrate-runtime/kit` subpath — five E1 provider-factory helpers that collapse the repeated composition-root wiring — and validate it by migrating `pack-kids-football` + swapping `gridiron`'s inference providers.

**Architecture:** A new `src/kit/` directory inside `layers/substrate/libs/substrate-runtime`, exposed via a `./kit` `exports` entry. Every helper composes existing runtime/contracts primitives into NestJS `Provider[]` / `ModuleFragment`s. No kernel concept, no persistence, no request-path code — pure Ring-4/5 boot-time assembly. Additive + opt-in.

**Tech Stack:** TypeScript (pure ESM, `nodenext`, explicit `.js` import extensions), NestJS DI, `tsc -b` build, vitest unit tests, GitHub Packages publish.

**Spec:** `docs/superpowers/specs/2026-06-14-substrate-cdk-pack-kit-design.md`

---

## Grounding corrections (these supersede the spec's Components section)

Real-code reads refined four design assumptions. The spec's intent is unchanged; these are the accurate shapes:

1. **`AuthBootstrapBase` injects THREE deps, not consent.** The real `pack-kids-football-auth.bootstrap.ts` injects only `PolicyEngine`, `PACK_ROLE_ASSIGNMENT_REPOSITORY`, `TENANT_REGISTRY` — there is **no `ConsentEngine` and no consent-receipt seeding** (consent repos are bound declaratively in `forRoot`). The base owns `validateDecoratorReferences` + idempotent grant seeding; `DemoGrant = { tenantId, userId, roleId }` (grants group by tenant → resolve `tenantPackId` → `grantIfAbsent`). Pack-data seeds (members/teams/…) hang off an overridable `seedDemoData()` hook, not the base.
2. **`dbAuthWiring` takes an app-supplied `createClient` factory.** The kit lives in `substrate-runtime`, which has no app Prisma schema, so it cannot `extends PrismaClient` itself. The app passes `createClient: (url) => new PrismaClient(...)`; the kit wraps lifecycle via a `DbAuthClientDisposer` provider (`$disconnect` on destroy). It also enforces `SUBSTRATE_RLS_ENABLED=true` (the safety the audit asked for).
3. **`inferenceBackboneProviders` closes over `runner` + `catalog` instances** and takes `withDistributionCatalog: boolean` (gridiron=true → 5-arg router; markets=false → 4-arg). It exports a reusable `createNullMemberResolution(label)` to replace the per-app `NULL_MEMBER_RESOLUTION` stub. It does **not** cover pack-football's bespoke helper (flag-gated in-memory evidence + pack-private runner token + optional run-recorder) — that stays as-is.
4. **`selectAdapter` is the simple symmetric `useClass` fork** (`{ provide: token, useClass: useDb ? prisma : inMemory }`). kids-football's repos use a *request-scoped store-map* pattern that is **not** symmetric, so the kids-football migration does **not** route its repos through `selectAdapter` (those keep their existing wiring). `selectAdapter` is unit-tested in the kit and adopted by symmetric-pattern products opportunistically. *(Flagged for the founder — see handoff.)*

## Repos & PR sequence (Phase 1 spans three repos)

1. **`layers/substrate`** — build the kit (Tasks 1–7), open its PR, **merge + publish a new runtime version**.
2. **`domains/exercir`** — bump the runtime dep, migrate kids-football (Task 8), open its PR. *Depends on (1) being published.*
3. **`domains/gridiron`** — bump the runtime dep, swap inference (Task 9), open its PR. *Depends on (1) being published.*

The ADR (Task 10) lands in `layers/specs`. Each repo is PR-gated; never commit to `main`. **Create a feature branch in each repo before its first commit.**

---

## File structure

**New (in `layers/substrate/libs/substrate-runtime/src/kit/`):**
- `module-fragment.ts` — the `ModuleFragment` currency type.
- `select-adapter.ts` — `selectAdapter()`.
- `null-member-resolution.ts` — `createNullMemberResolution()`.
- `inference-backbone-providers.ts` — `inferenceBackboneProviders()`.
- `db-auth-wiring.ts` — `dbAuthWiring()` + `ManagedAppRolePrismaClient`-free disposer + `DB_AUTH_CLIENT`.
- `pack-preset.ts` — `packPreset()`.
- `auth-bootstrap-base.ts` — `AuthBootstrapBase` + `DemoGrant`.
- `index.ts` — barrel re-exporting all of the above.
- one `*.spec.ts` per helper file.

**Modified:**
- `libs/substrate-runtime/package.json` — add `./kit` export; bump `version`.
- `libs/substrate-runtime/CHANGELOG.md` — release entry.
- `domains/exercir/apps/pack-kids-football-api/src/app/app.module.ts` — use `packPreset` + `dbAuthWiring`.
- `domains/exercir/apps/pack-kids-football-api/src/app/pack-kids-football-auth.bootstrap.ts` — extend `AuthBootstrapBase`.
- `domains/exercir/apps/pack-kids-football-api/package.json` — bump runtime dep.
- `domains/gridiron/apps/gridiron-api/src/app/app.module.ts` — use `inferenceBackboneProviders`.
- `domains/gridiron/apps/gridiron-api/package.json` — bump runtime dep.

---

## Task 1: Scaffold the `kit` subpath

**Files:**
- Create: `libs/substrate-runtime/src/kit/module-fragment.ts`
- Create: `libs/substrate-runtime/src/kit/index.ts`
- Modify: `libs/substrate-runtime/package.json` (exports map)
- Test: `libs/substrate-runtime/src/kit/kit-subpath.spec.ts`

- [ ] **Step 1: Write the failing test** — `src/kit/kit-subpath.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as kit from './index.js';

describe('substrate-runtime/kit barrel', () => {
  it('exports the ModuleFragment-based helpers', () => {
    expect(typeof kit.selectAdapter).toBe('function');
    expect(typeof kit.inferenceBackboneProviders).toBe('function');
    expect(typeof kit.dbAuthWiring).toBe('function');
    expect(typeof kit.packPreset).toBe('function');
    expect(typeof kit.createNullMemberResolution).toBe('function');
    expect(typeof kit.AuthBootstrapBase).toBe('function');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run (from `layers/substrate/`): `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/kit-subpath.spec.ts`
Expected: FAIL — `Cannot find module './index.js'` (file not created yet).

- [ ] **Step 3: Create the `ModuleFragment` type**

```ts
// src/kit/module-fragment.ts
import type { DynamicModule, Provider, Type } from '@nestjs/common';

/** A spreadable slice of a NestJS module — the kit's E1 currency. */
export interface ModuleFragment {
  imports?: Array<Type | DynamicModule>;
  providers?: Provider[];
  controllers?: Type[];
}
```

- [ ] **Step 4: Create the barrel** (helpers added in later tasks; barrel grows with them)

```ts
// src/kit/index.ts
export * from './module-fragment.js';
export * from './select-adapter.js';
export * from './null-member-resolution.js';
export * from './inference-backbone-providers.js';
export * from './db-auth-wiring.js';
export * from './pack-preset.js';
export * from './auth-bootstrap-base.js';
```

(The test stays red until the helper files exist — that's expected; it goes green at the end of Task 6. To keep this task self-contained, temporarily comment out the not-yet-created re-exports and the assertions for them, uncommenting each as its task lands. Simplest: keep the barrel complete and accept this one test red until Task 6, OR create empty stub files now. **Chosen: create empty stubs now** — see Step 5.)

- [ ] **Step 5: Create empty stub files** so the barrel resolves

Create each of these with a single placeholder line `export {};` (replaced in later tasks): `select-adapter.ts`, `null-member-resolution.ts`, `inference-backbone-providers.ts`, `db-auth-wiring.ts`, `pack-preset.ts`, `auth-bootstrap-base.ts`. The Task-1 test will still fail on the missing functions — that's fine; mark it `it.todo` for now and convert back in Task 6. **Cleaner alternative chosen:** delete `kit-subpath.spec.ts`'s per-function assertions, keep only `expect(kit).toBeDefined()`, and add the full barrel assertion as the final step of Task 6.

Rewrite `src/kit/kit-subpath.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as kit from './index.js';
describe('substrate-runtime/kit barrel', () => {
  it('resolves', () => { expect(kit).toBeDefined(); });
});
```

- [ ] **Step 6: Add the `./kit` export to `package.json`**

In `libs/substrate-runtime/package.json`, add to `exports` (mirroring `./testing`):

```json
"./kit": {
  "types": "./dist/kit/index.d.ts",
  "import": "./dist/kit/index.js",
  "default": "./dist/kit/index.js"
}
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/kit-subpath.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git switch -c feat/substrate-kit   # first kit commit in layers/substrate
git add libs/substrate-runtime/src/kit libs/substrate-runtime/package.json
git commit -m "feat(kit): scaffold substrate-runtime/kit subpath + ModuleFragment"
```

---

## Task 2: `selectAdapter`

**Files:**
- Modify: `libs/substrate-runtime/src/kit/select-adapter.ts`
- Test: `libs/substrate-runtime/src/kit/select-adapter.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { selectAdapter } from './select-adapter.js';

class PrismaImpl {}
class InMemoryImpl {}
const TOKEN = Symbol('REPO');

describe('selectAdapter', () => {
  it('binds the Prisma impl when useDb is true', () => {
    expect(selectAdapter(true, TOKEN, PrismaImpl, InMemoryImpl))
      .toEqual({ provide: TOKEN, useClass: PrismaImpl });
  });
  it('binds the in-memory impl when useDb is false', () => {
    expect(selectAdapter(false, TOKEN, PrismaImpl, InMemoryImpl))
      .toEqual({ provide: TOKEN, useClass: InMemoryImpl });
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/select-adapter.spec.ts`
Expected: FAIL — `selectAdapter is not a function`.

- [ ] **Step 3: Implement**

```ts
// src/kit/select-adapter.ts
import type { Provider, Type } from '@nestjs/common';

/**
 * The simple symmetric in-memory-vs-Prisma fork: `{ provide, useClass }`.
 * For repos whose two impls share a constructor shape. (Request-scoped /
 * store-map repos use their own wiring — this helper does not cover them.)
 */
export function selectAdapter<T>(
  useDb: boolean,
  token: symbol,
  prismaImpl: Type<T>,
  inMemoryImpl: Type<T>,
): Provider {
  return { provide: token, useClass: useDb ? prismaImpl : inMemoryImpl };
}
```

- [ ] **Step 4: Run, verify it passes** — same command. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src/kit/select-adapter.ts libs/substrate-runtime/src/kit/select-adapter.spec.ts
git commit -m "feat(kit): selectAdapter (symmetric in-memory/Prisma fork)"
```

---

## Task 3: `createNullMemberResolution` + `inferenceBackboneProviders`

**Files:**
- Modify: `libs/substrate-runtime/src/kit/null-member-resolution.ts`
- Modify: `libs/substrate-runtime/src/kit/inference-backbone-providers.ts`
- Test: `libs/substrate-runtime/src/kit/inference-backbone-providers.spec.ts`

> Import note: runtime-internal symbols (`INFERENCE_CATALOG`, `EVIDENCE_REPOSITORY`, `GucPrismaRunner`, `InferenceBackboneRouter`, `PrismaEvidenceLogRepository`) are imported **relatively** — mirror the exact relative paths used in `src/composition-root/substrate.module.ts` and `src/inference/index.ts`. Contracts symbols come from the package (`@de-braighter/substrate-contracts` and `.../inference`).

- [ ] **Step 1: Write `createNullMemberResolution`**

```ts
// src/kit/null-member-resolution.ts
import type { MemberResolution } from '@de-braighter/substrate-contracts';

/** A MemberResolution stub for packs with no aggregate subjects — rejects if ever called. */
export function createNullMemberResolution(label: string): MemberResolution {
  return {
    resolveMembers(): Promise<never> {
      return Promise.reject(
        new Error(`${label}: MemberResolution.resolveMembers should not be called — no aggregate subjects`),
      );
    },
  };
}
```

- [ ] **Step 2: Write the failing test (provider-shape + DI-resolve)**

```ts
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { DISTRIBUTION_CATALOG, MEMBER_RESOLUTION_PORT } from '@de-braighter/substrate-contracts';
import { INFERENCE_BACKBONE, NUMPYRO_SIDECAR } from '@de-braighter/substrate-contracts/inference';
import { EVIDENCE_REPOSITORY, INFERENCE_CATALOG, InferenceBackboneRouter } from '@de-braighter/substrate-runtime';
import { inferenceBackboneProviders } from './inference-backbone-providers.js';

const fakeRunner = {} as never;                         // PrismaEvidenceLogRepository only stores it
const fakeCatalog = { families: [] } as never;          // shape not exercised at construction
const fakeDist = {} as never;

describe('inferenceBackboneProviders', () => {
  it('emits the 5-provider chain (markets shape, no distribution catalog)', () => {
    const ps = inferenceBackboneProviders({ catalog: fakeCatalog, runner: fakeRunner });
    const tokens = ps.map((p) => (p as { provide: unknown }).provide);
    expect(tokens).toEqual([INFERENCE_CATALOG, EVIDENCE_REPOSITORY, NUMPYRO_SIDECAR, MEMBER_RESOLUTION_PORT, INFERENCE_BACKBONE]);
    const backbone = ps[4] as { inject: unknown[] };
    expect(backbone.inject).not.toContain(DISTRIBUTION_CATALOG);  // 4-arg router
  });

  it('adds DISTRIBUTION_CATALOG to the router inject when withDistributionCatalog (gridiron shape)', () => {
    const ps = inferenceBackboneProviders({ catalog: fakeCatalog, runner: fakeRunner, withDistributionCatalog: true });
    const backbone = ps[4] as { inject: unknown[] };
    expect(backbone.inject).toContain(DISTRIBUTION_CATALOG);
  });

  it('resolves INFERENCE_BACKBONE to an InferenceBackboneRouter', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ...inferenceBackboneProviders({ catalog: fakeCatalog, runner: fakeRunner, withDistributionCatalog: true }),
        { provide: DISTRIBUTION_CATALOG, useValue: fakeDist },
      ],
    }).compile();
    expect(moduleRef.get(INFERENCE_BACKBONE)).toBeInstanceOf(InferenceBackboneRouter);
  });
});
```

- [ ] **Step 3: Run, verify it fails**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/inference-backbone-providers.spec.ts`
Expected: FAIL — `inferenceBackboneProviders is not a function`.

- [ ] **Step 4: Implement** (verify the relative import paths against `substrate.module.ts`)

```ts
// src/kit/inference-backbone-providers.ts
import type { Provider } from '@nestjs/common';
import {
  DISTRIBUTION_CATALOG,
  MEMBER_RESOLUTION_PORT,
  type DistributionCatalog,
  type MemberResolution,
} from '@de-braighter/substrate-contracts';
import { INFERENCE_BACKBONE, NUMPYRO_SIDECAR } from '@de-braighter/substrate-contracts/inference';
// Relative — confirm paths against src/composition-root/substrate.module.ts + src/inference/index.ts:
import { INFERENCE_CATALOG, EVIDENCE_REPOSITORY, type EvidenceRepository, type InferenceCatalog } from '../inference/inference-catalog.port.js';
import { InferenceBackboneRouter } from '../inference/inference-backbone-router.js';
import { PrismaEvidenceLogRepository } from '../inference/adapters/prisma-evidence-log.repository.js';
import type { GucPrismaRunner } from '../scoped-prisma/guc-prisma-runner.js';
import { createNullMemberResolution } from './null-member-resolution.js';

export interface InferenceBackboneProvidersOptions {
  catalog: InferenceCatalog;
  runner: GucPrismaRunner;
  members?: MemberResolution;          // default: createNullMemberResolution('inference')
  sidecar?: unknown;                   // default: null
  withDistributionCatalog?: boolean;   // default: false (markets shape); true = gridiron shape
}

/** Reproduces the gridiron/markets inference chain. NOT pack-football's bespoke helper. */
export function inferenceBackboneProviders(opts: InferenceBackboneProvidersOptions): Provider[] {
  const members = opts.members ?? createNullMemberResolution('inference');
  const sidecar = opts.sidecar ?? null;

  const backbone: Provider = opts.withDistributionCatalog
    ? {
        provide: INFERENCE_BACKBONE,
        useFactory: (cat: InferenceCatalog, evidence: EvidenceRepository, sc: unknown, mem: MemberResolution, dist: DistributionCatalog) =>
          new InferenceBackboneRouter(cat, evidence, sc as never, mem, dist),
        inject: [INFERENCE_CATALOG, EVIDENCE_REPOSITORY, NUMPYRO_SIDECAR, MEMBER_RESOLUTION_PORT, DISTRIBUTION_CATALOG],
      }
    : {
        provide: INFERENCE_BACKBONE,
        useFactory: (cat: InferenceCatalog, evidence: EvidenceRepository, sc: unknown, mem: MemberResolution) =>
          new InferenceBackboneRouter(cat, evidence, sc as never, mem),
        inject: [INFERENCE_CATALOG, EVIDENCE_REPOSITORY, NUMPYRO_SIDECAR, MEMBER_RESOLUTION_PORT],
      };

  return [
    { provide: INFERENCE_CATALOG, useValue: opts.catalog },
    {
      provide: EVIDENCE_REPOSITORY,
      useFactory: (cat: InferenceCatalog): EvidenceRepository => new PrismaEvidenceLogRepository(opts.runner, cat),
      inject: [INFERENCE_CATALOG],
    },
    { provide: NUMPYRO_SIDECAR, useValue: sidecar },
    { provide: MEMBER_RESOLUTION_PORT, useValue: members },
    backbone,
  ];
}
```

- [ ] **Step 5: Run, verify it passes** — same command. Expected: PASS (3 tests). If the `InferenceBackboneRouter`/evidence relative paths are wrong, fix per the real `substrate.module.ts` imports, then re-run.

- [ ] **Step 6: Commit**

```bash
git add libs/substrate-runtime/src/kit/null-member-resolution.ts libs/substrate-runtime/src/kit/inference-backbone-providers.ts libs/substrate-runtime/src/kit/inference-backbone-providers.spec.ts
git commit -m "feat(kit): inferenceBackboneProviders + createNullMemberResolution"
```

---

## Task 4: `dbAuthWiring`

**Files:**
- Modify: `libs/substrate-runtime/src/kit/db-auth-wiring.ts`
- Test: `libs/substrate-runtime/src/kit/db-auth-wiring.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { dbAuthWiring, DB_AUTH_CLIENT } from './db-auth-wiring.js';

const fakeDbModule = { forRoot: vi.fn((c: unknown) => ({ module: class Db {}, providers: [{ provide: 'C', useValue: c }] })) };
const createClient = () => ({ $disconnect: async () => {} });

describe('dbAuthWiring', () => {
  it('returns null + empty fragment when the flag is off', () => {
    const out = dbAuthWiring({ flag: 'X', createClient, dbModule: fakeDbModule, env: {} });
    expect(out.client).toBeNull();
    expect(out.fragment).toEqual({ imports: [], providers: [] });
  });

  it('throws when enabled but the url env is missing', () => {
    expect(() => dbAuthWiring({ flag: 'X', createClient, dbModule: fakeDbModule, env: { X: 'true', SUBSTRATE_RLS_ENABLED: 'true' } }))
      .toThrow(/requires SUBSTRATE_APP_DATABASE_URL/);
  });

  it('throws when enabled but RLS is not on', () => {
    expect(() => dbAuthWiring({ flag: 'X', createClient, dbModule: fakeDbModule, env: { X: 'true', SUBSTRATE_APP_DATABASE_URL: 'postgres://x' } }))
      .toThrow(/requires SUBSTRATE_RLS_ENABLED=true/);
  });

  it('creates the client + mounts the db module + binds DB_AUTH_CLIENT when enabled', () => {
    const out = dbAuthWiring({ flag: 'X', createClient, dbModule: fakeDbModule, env: { X: 'true', SUBSTRATE_APP_DATABASE_URL: 'postgres://x', SUBSTRATE_RLS_ENABLED: 'true' } });
    expect(out.client).not.toBeNull();
    expect(fakeDbModule.forRoot).toHaveBeenCalledWith(out.client);
    expect(out.fragment.imports).toHaveLength(1);
    const provided = (out.fragment.providers ?? []).map((p) => (p as { provide: unknown }).provide);
    expect(provided).toContain(DB_AUTH_CLIENT);
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/db-auth-wiring.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/kit/db-auth-wiring.ts
import { Inject, Injectable, type DynamicModule, type OnModuleDestroy, type Provider } from '@nestjs/common';
import type { ModuleFragment } from './module-fragment.js';

/** Minimal disconnect-able client shape — avoids an @prisma/client dependency in the runtime. */
export interface DisposablePrismaLike { $disconnect(): Promise<void>; }

export const DB_AUTH_CLIENT: unique symbol = Symbol.for('@de-braighter/substrate-runtime/kit/DB_AUTH_CLIENT');

/** Calls `$disconnect()` on the app-role client at module destroy. */
@Injectable()
export class DbAuthClientDisposer implements OnModuleDestroy {
  constructor(@Inject(DB_AUTH_CLIENT) private readonly client: DisposablePrismaLike) {}
  async onModuleDestroy(): Promise<void> { await this.client.$disconnect(); }
}

export interface DbAuthWiringOptions<C extends DisposablePrismaLike> {
  flag: string;                                  // e.g. 'PACK_KIDS_FOOTBALL_DB'
  createClient: (url: string) => C;              // app news up ITS PrismaClient
  dbModule: { forRoot(client: C): DynamicModule };
  url?: string;                                  // env var name; default 'SUBSTRATE_APP_DATABASE_URL'
  requireRls?: boolean;                          // default true
  env?: NodeJS.ProcessEnv;                       // default process.env
}

export function dbAuthWiring<C extends DisposablePrismaLike>(
  opts: DbAuthWiringOptions<C>,
): { client: C | null; fragment: ModuleFragment } {
  const env = opts.env ?? process.env;
  if (env[opts.flag] !== 'true') return { client: null, fragment: { imports: [], providers: [] } };

  const urlVar = opts.url ?? 'SUBSTRATE_APP_DATABASE_URL';
  const url = env[urlVar];
  if (!url) throw new Error(`${opts.flag}=true requires ${urlVar}.`);
  if ((opts.requireRls ?? true) && env['SUBSTRATE_RLS_ENABLED'] !== 'true') {
    throw new Error(`${opts.flag}=true requires SUBSTRATE_RLS_ENABLED=true.`);
  }

  const client = opts.createClient(url);
  return {
    client,
    fragment: {
      imports: [opts.dbModule.forRoot(client)],
      providers: [{ provide: DB_AUTH_CLIENT, useValue: client } as Provider, DbAuthClientDisposer],
    },
  };
}
```

- [ ] **Step 4: Run, verify it passes** — same command. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src/kit/db-auth-wiring.ts libs/substrate-runtime/src/kit/db-auth-wiring.spec.ts
git commit -m "feat(kit): dbAuthWiring (managed app-role client lifecycle + RLS guard)"
```

---

## Task 5: `packPreset`

**Files:**
- Modify: `libs/substrate-runtime/src/kit/pack-preset.ts`
- Test: `libs/substrate-runtime/src/kit/pack-preset.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SubstrateModule } from '@de-braighter/substrate-runtime';
import { packPreset } from './pack-preset.js';

const tenantRegistry = { resolveTenantPackId: async () => null } as never;

describe('packPreset', () => {
  it('returns a fragment importing SubstrateModule.forRoot', () => {
    const frag = packPreset({ manifests: [], tenantRegistry });
    expect(frag.imports).toHaveLength(1);
    expect((frag.imports![0] as { module: unknown }).module).toBe(SubstrateModule);
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/pack-preset.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** (confirm the `SubstrateModuleOptions` import path against `src/composition-root/substrate.module.ts`)

```ts
// src/kit/pack-preset.ts
import type { PackManifest } from '@de-braighter/substrate-contracts';
import { SubstrateModule, type SubstrateModuleOptions } from '../composition-root/substrate.module.js';
import type { TenantRegistry } from '../tenant-registry/tenant-registry.js';
import type { ModuleFragment } from './module-fragment.js';

export interface PackPresetOptions {
  manifests: readonly PackManifest[];
  tenantRegistry: TenantRegistry;
  packRoleAssignmentRepository?: SubstrateModuleOptions['packRoleAssignmentRepository'];
  consentReceiptRepository?: SubstrateModuleOptions['consentReceiptRepository'];
}

/** Common-case composer: SubstrateModule.forRoot with in-memory repo defaults (forRoot supplies them when omitted). */
export function packPreset(opts: PackPresetOptions): ModuleFragment {
  const forRootOpts: SubstrateModuleOptions = {
    tenantRegistry: opts.tenantRegistry,
    manifests: opts.manifests,
  };
  if (opts.packRoleAssignmentRepository) forRootOpts.packRoleAssignmentRepository = opts.packRoleAssignmentRepository;
  if (opts.consentReceiptRepository) forRootOpts.consentReceiptRepository = opts.consentReceiptRepository;
  return { imports: [SubstrateModule.forRoot(forRootOpts)], providers: [] };
}
```

- [ ] **Step 4: Run, verify it passes** — same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src/kit/pack-preset.ts libs/substrate-runtime/src/kit/pack-preset.spec.ts
git commit -m "feat(kit): packPreset (common-case forRoot composer)"
```

---

## Task 6: `AuthBootstrapBase`

**Files:**
- Modify: `libs/substrate-runtime/src/kit/auth-bootstrap-base.ts`
- Modify: `libs/substrate-runtime/src/kit/kit-subpath.spec.ts` (restore full barrel assertion)
- Test: `libs/substrate-runtime/src/kit/auth-bootstrap-base.spec.ts`

- [ ] **Step 1: Write the failing test** (pure unit — `new` the subclass with fakes, mirroring `onboarding.service.spec.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { AuthBootstrapBase, type DemoGrant } from './auth-bootstrap-base.js';

class TestBootstrap extends AuthBootstrapBase {
  protected readonly controllers = [];
  protected readonly packKey = 'test-pack';
  protected readonly demoGrants: readonly DemoGrant[] = [
    { tenantId: 't1', userId: 'u1', roleId: 'admin' },
    { tenantId: 't1', userId: 'u2', roleId: 'coach' },
  ];
}

function build(active: Array<{ roleId: string }> = []) {
  const policyEngine = { validateDecoratorReferences: vi.fn() };
  const roleAssignments = { findActiveForUser: vi.fn(async () => active), grant: vi.fn(async () => {}) };
  const tenants = { resolveTenantPackId: vi.fn(async () => 'tpid-1') };
  return { sut: new TestBootstrap(policyEngine as never, roleAssignments as never, tenants as never), policyEngine, roleAssignments, tenants };
}

describe('AuthBootstrapBase', () => {
  it('validates decorator references then grants absent roles', async () => {
    const { sut, policyEngine, roleAssignments, tenants } = build([]);
    await sut.onApplicationBootstrap();
    expect(policyEngine.validateDecoratorReferences).toHaveBeenCalledOnce();
    expect(tenants.resolveTenantPackId).toHaveBeenCalledWith('t1', 'test-pack');
    expect(roleAssignments.grant).toHaveBeenCalledTimes(2);
  });

  it('skips a grant that is already active (idempotent)', async () => {
    const { sut, roleAssignments } = build([{ roleId: 'admin' }, { roleId: 'coach' }]);
    await sut.onApplicationBootstrap();
    expect(roleAssignments.grant).not.toHaveBeenCalled();
  });

  it('warns and skips when the tenant-pack does not resolve', async () => {
    const { sut, roleAssignments, tenants } = build([]);
    tenants.resolveTenantPackId.mockResolvedValue(null as never);
    await sut.onApplicationBootstrap();
    expect(roleAssignments.grant).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/auth-bootstrap-base.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** (confirm relative paths for `PolicyEngine`, `collectDecoratorPermissionIds`, `TENANT_REGISTRY` against `policy-engine/` + `tenant-registry/`)

```ts
// src/kit/auth-bootstrap-base.ts
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type Type } from '@nestjs/common';
import { PACK_ROLE_ASSIGNMENT_REPOSITORY, type PackRoleAssignmentRepository } from '@de-braighter/substrate-contracts';
import { PolicyEngine } from '../policy-engine/policy.engine.js';
import { collectDecoratorPermissionIds } from '../policy-engine/collect-decorator-permission-ids.js';
import { TENANT_REGISTRY, type TenantRegistry } from '../tenant-registry/tenant-registry.js';

export interface DemoGrant { tenantId: string; userId: string; roleId: string; }

/**
 * Shared boot-time auth wiring: (1) fail-fast decorator-reference validation,
 * (2) idempotent demo-mode role-grant seeding. Subclass supplies controllers,
 * packKey, demoGrants; override seedDemoData() for pack-data seeds.
 */
@Injectable()
export abstract class AuthBootstrapBase implements OnApplicationBootstrap {
  protected abstract readonly controllers: readonly Type[];
  protected abstract readonly packKey: string;
  protected abstract readonly demoGrants: readonly DemoGrant[];
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    @Inject(PolicyEngine) protected readonly policyEngine: PolicyEngine,
    @Inject(PACK_ROLE_ASSIGNMENT_REPOSITORY) protected readonly roleAssignments: PackRoleAssignmentRepository,
    @Inject(TENANT_REGISTRY) protected readonly tenants: TenantRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.validateDecoratorReferences();
    await this.seedDemoGrants();
    await this.seedDemoData();
  }

  /** Override for pack-data demo seeding (members/teams/…). Default no-op. */
  protected async seedDemoData(): Promise<void> {}

  protected validateDecoratorReferences(): void {
    this.policyEngine.validateDecoratorReferences(collectDecoratorPermissionIds([...this.controllers]));
  }

  protected async seedDemoGrants(): Promise<void> {
    const byTenant = new Map<string, DemoGrant[]>();
    for (const g of this.demoGrants) byTenant.set(g.tenantId, [...(byTenant.get(g.tenantId) ?? []), g]);
    for (const [tenantId, grants] of byTenant) {
      const tpid = await this.tenants.resolveTenantPackId(tenantId, this.packKey);
      if (!tpid) { this.logger.warn(`demo seed skipped — tenant-pack unresolved for ${tenantId}/${this.packKey}`); continue; }
      for (const g of grants) await this.grantIfAbsent(tpid, g.userId, g.roleId);
    }
  }

  protected async grantIfAbsent(tenantPackId: string, userId: string, roleId: string): Promise<void> {
    const active = await this.roleAssignments.findActiveForUser({ tenantPackId, userId });
    if (active.some((a) => a.roleId === roleId)) return;
    await this.roleAssignments.grant({ tenantPackId, userId, packKey: this.packKey, roleId });
    this.logger.log(`demo seed: granted ${roleId} to ${userId} in ${tenantPackId}`);
  }
}
```

- [ ] **Step 4: Run, verify it passes** — same command. Expected: PASS (3 tests).

- [ ] **Step 5: Restore the full barrel assertion** in `kit-subpath.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as kit from './index.js';
describe('substrate-runtime/kit barrel', () => {
  it('exports all helpers', () => {
    for (const name of ['selectAdapter', 'inferenceBackboneProviders', 'dbAuthWiring', 'packPreset', 'createNullMemberResolution', 'AuthBootstrapBase']) {
      expect(kit[name as keyof typeof kit], name).toBeDefined();
    }
  });
});
```

- [ ] **Step 6: Run the whole kit suite + lint** — `npx nx test substrate-runtime` then `npx nx lint substrate-runtime`. Expected: PASS, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add libs/substrate-runtime/src/kit/auth-bootstrap-base.ts libs/substrate-runtime/src/kit/auth-bootstrap-base.spec.ts libs/substrate-runtime/src/kit/kit-subpath.spec.ts
git commit -m "feat(kit): AuthBootstrapBase (decorator validation + idempotent grant seed)"
```

---

## Task 7: Build, version, publish

**Files:**
- Modify: `libs/substrate-runtime/package.json` (`version`)
- Modify: `libs/substrate-runtime/CHANGELOG.md`

- [ ] **Step 1: Full build** — from `layers/substrate/`: `npx nx build substrate-runtime`. Expected: clean `tsc -b`; confirm `dist/kit/index.js` + `dist/kit/index.d.ts` exist.

- [ ] **Step 2: Bump the version** — in `libs/substrate-runtime/package.json`, `2.5.0` → `2.6.0` (minor: additive subpath).

- [ ] **Step 3: CHANGELOG entry** — add under a new `## [2.6.0]` heading: "Added: `@de-braighter/substrate-runtime/kit` composition kit (packPreset, dbAuthWiring, inferenceBackboneProviders, selectAdapter, AuthBootstrapBase, createNullMemberResolution)."

- [ ] **Step 4: Open the substrate PR + run the verifier wave** (see Task 11). **Merge it.**

- [ ] **Step 5: Publish** — from `layers/substrate/`, after merge: `npm run publish:runtime`.
Expected: `guard-version.mjs` passes (2.6.0 is new) → build → `npm publish`. Requires `GITHUB_TOKEN` with `write:packages`. **If the executing context lacks publish rights, hand this step to the founder.**

- [ ] **Step 6: Confirm published** — `npm view @de-braighter/substrate-runtime@2.6.0 version` returns `2.6.0`.

---

## Task 8: Migrate `pack-kids-football` (`domains/exercir`)

> **Precondition:** runtime `2.6.0` is published. Create branch `feat/adopt-substrate-kit` in `domains/exercir`.

**Files:**
- Modify: `apps/pack-kids-football-api/package.json` (dep bump)
- Modify: `apps/pack-kids-football-api/src/app/pack-kids-football-auth.bootstrap.ts`
- Modify: `apps/pack-kids-football-api/src/app/app.module.ts`

- [ ] **Step 1: Bump the dep + install** — set `@de-braighter/substrate-runtime` to `^2.6.0` in `apps/pack-kids-football-api/package.json`; run `npm install` (needs `GITHUB_TOKEN`).

- [ ] **Step 2: Refactor the auth bootstrap to extend `AuthBootstrapBase`**

Replace the class body in `pack-kids-football-auth.bootstrap.ts` (keep the `PACK_KF_CONTROLLERS` export + the four `seedDemo*` imports). New class:

```ts
import { Injectable } from '@nestjs/common';
import { AuthBootstrapBase, type DemoGrant } from '@de-braighter/substrate-runtime/kit';
import { KIDS_FOOTBALL_PACK_KEY, KF_ROLES } from '@de-braighter/pack-kids-football';
import {
  STUB_CLUB_A_ADMIN_USER_ID, STUB_CLUB_A_COACH_USER_ID, STUB_CLUB_A_TEAM_MANAGER_USER_ID, STUB_CLUB_A_TENANT_ID,
  STUB_CLUB_B_ADMIN_USER_ID, STUB_CLUB_B_TENANT_ID,
} from '../config/stub-clubs.js';
import {
  packKidsFootballDbEnabled, seedDemoDrills, seedDemoMembers, seedDemoResources, seedDemoTeams,
} from './pack-kids-football.module.js';

@Injectable()
export class PackKidsFootballAuthBootstrap extends AuthBootstrapBase {
  protected readonly controllers = [...PACK_KF_CONTROLLERS];
  protected readonly packKey = KIDS_FOOTBALL_PACK_KEY;
  protected readonly demoGrants: readonly DemoGrant[] = [
    { tenantId: STUB_CLUB_A_TENANT_ID, userId: STUB_CLUB_A_ADMIN_USER_ID, roleId: KF_ROLES.clubAdmin },
    { tenantId: STUB_CLUB_A_TENANT_ID, userId: STUB_CLUB_A_COACH_USER_ID, roleId: KF_ROLES.coach },
    { tenantId: STUB_CLUB_A_TENANT_ID, userId: STUB_CLUB_A_TEAM_MANAGER_USER_ID, roleId: KF_ROLES.teamManager },
    { tenantId: STUB_CLUB_B_TENANT_ID, userId: STUB_CLUB_B_ADMIN_USER_ID, roleId: KF_ROLES.clubAdmin },
  ];

  protected override async seedDemoData(): Promise<void> {
    if (packKidsFootballDbEnabled()) return;
    const tpidA = await this.tenants.resolveTenantPackId(STUB_CLUB_A_TENANT_ID, this.packKey);
    const tpidB = await this.tenants.resolveTenantPackId(STUB_CLUB_B_TENANT_ID, this.packKey);
    if (!tpidA || !tpidB) { this.logger.warn('demo data seed skipped — tenant-pack unresolved'); return; }
    await seedDemoMembers(tpidA, tpidB);
    await seedDemoTeams(tpidA, tpidB);
    await seedDemoResources(tpidA, tpidB);
    await seedDemoDrills(tpidA, tpidB);
  }
}
```

Delete the old constructor, `validateDecoratorReferences`, `seedDemoGrants`, `seedClubA/B`, `grantIfAbsent`, and the four `seedDemo*IfInMemory` methods — all now in the base (or folded into `seedDemoData`).

- [ ] **Step 3: Simplify `app.module.ts`** to use `packPreset` + `dbAuthWiring`

```ts
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { dbAuthWiring, packPreset } from '@de-braighter/substrate-runtime/kit';
import { PACK_KIDS_FOOTBALL_MANIFEST } from '@de-braighter/pack-kids-football';
import { STUB_CLUBS } from '../config/stub-clubs.js';
import { MutableStubTenantRegistry, KF_MUTABLE_TENANT_REGISTRY } from '../config/mutable-stub-tenant.registry.js';
import { PACK_KF_CONTROLLERS, PackKidsFootballAuthBootstrap } from './pack-kids-football-auth.bootstrap.js';
import { KidsFootballOnboardingService } from './onboarding.service.js';
import { PackKidsFootballModule, PackKidsFootballDbModule } from './pack-kids-football.module.js';

const kfTenantRegistry = new MutableStubTenantRegistry(STUB_CLUBS);
const core = packPreset({ manifests: [PACK_KIDS_FOOTBALL_MANIFEST], tenantRegistry: kfTenantRegistry });
const db = dbAuthWiring({
  flag: 'PACK_KIDS_FOOTBALL_DB',
  createClient: (url) => new PrismaClient({ datasources: { db: { url } } }),
  dbModule: PackKidsFootballDbModule,
});

@Module({
  imports: [...(core.imports ?? []), PackKidsFootballModule, ...(db.fragment.imports ?? [])],
  controllers: [...PACK_KF_CONTROLLERS],
  providers: [
    ...(core.providers ?? []),
    ...(db.fragment.providers ?? []),
    PackKidsFootballAuthBootstrap,
    KidsFootballOnboardingService,
    { provide: KF_MUTABLE_TENANT_REGISTRY, useValue: kfTenantRegistry },
  ],
})
export class AppModule {}
```

Removed: `ManagedPrismaClient`, the `appRoleClient` null dance, the `InMemory*Repository`/`SubstrateModule` imports, and the `requireKidsFootballDbEnv` call (now inside `dbAuthWiring`).

- [ ] **Step 4: Run the parity proof** — `npx nx test pack-kids-football-api`.
Expected: PASS — **critically** `app-module.smoke.e2e.spec.ts` stays green (boots the real `AppModule`, runs the bootstrap, asserts club-A 200 + cross-club isolation). This is the behavioral-parity proof. Also run `npx nx test pack-kids-football`.

- [ ] **Step 5: Build + lint** — `npx nx build pack-kids-football-api && npx nx lint pack-kids-football-api`. Expected: clean. (If NestJS fails to resolve the inherited `@Inject` constructor at boot — symptom: the smoke test throws a DI resolution error — give the subclass an explicit `constructor(...) { super(...); }` re-declaring the three `@Inject` params. Re-run Step 4.)

- [ ] **Step 6: Commit**

```bash
git add apps/pack-kids-football-api
git commit -m "refactor(kids-football): adopt substrate-runtime/kit (packPreset, dbAuthWiring, AuthBootstrapBase)"
```

---

## Task 9: Swap `gridiron` inference providers (`domains/gridiron`)

> **Precondition:** runtime `2.6.0` is published. Create branch `feat/adopt-inference-kit` in `domains/gridiron`.

**Files:**
- Modify: `apps/gridiron-api/package.json` (dep bump)
- Modify: `apps/gridiron-api/src/app/app.module.ts`
- Test: `apps/gridiron-api/src/app/inference-wiring.spec.ts` (new)

- [ ] **Step 1: Bump the dep + install** — `@de-braighter/substrate-runtime` → `^2.6.0`; `npm install`.

- [ ] **Step 2: Replace the inference provider block.** In `app.module.ts`, delete the local `NULL_MEMBER_RESOLUTION` const and the five inference provider objects (`INFERENCE_CATALOG`, `EVIDENCE_REPOSITORY`, `NUMPYRO_SIDECAR`, `MEMBER_RESOLUTION_PORT`, `INFERENCE_BACKBONE`); replace with:

```ts
...inferenceBackboneProviders({ catalog, runner, withDistributionCatalog: true }),
```

Update imports: add `import { inferenceBackboneProviders } from '@de-braighter/substrate-runtime/kit';`. Remove the now-unused `INFERENCE_CATALOG, EVIDENCE_REPOSITORY, InferenceBackboneRouter, PrismaEvidenceLogRepository, type EvidenceRepository, type InferenceCatalog` (from substrate-runtime) and `DISTRIBUTION_CATALOG, MEMBER_RESOLUTION_PORT, type DistributionCatalog, type MemberResolution` (contracts) and `INFERENCE_BACKBONE, NUMPYRO_SIDECAR` (contracts/inference) — **keep `GucPrismaRunner`** (still used for `const runner`). Keep the existing `{ provide: GucPrismaRunner, useValue: runner }` and `DOMAIN_EVENT_PUBLISHER` providers.

- [ ] **Step 3: Add a wiring proof** — `apps/gridiron-api/src/app/inference-wiring.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { GucPrismaRunner, INFERENCE_CATALOG } from '@de-braighter/substrate-runtime';
import { DISTRIBUTION_CATALOG } from '@de-braighter/substrate-contracts';
import { INFERENCE_BACKBONE } from '@de-braighter/substrate-contracts/inference';
import { inferenceBackboneProviders } from '@de-braighter/substrate-runtime/kit';
import { buildGridironCatalog } from '../config/gridiron-catalog.js'; // confirm real path

describe('gridiron inference wiring', () => {
  it('assembles INFERENCE_BACKBONE via the kit factory', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ...inferenceBackboneProviders({ catalog: buildGridironCatalog(), runner: {} as GucPrismaRunner, withDistributionCatalog: true }),
        { provide: DISTRIBUTION_CATALOG, useValue: {} },
      ],
    }).compile();
    expect(moduleRef.get(INFERENCE_BACKBONE)).toBeDefined();
    expect(moduleRef.get(INFERENCE_CATALOG)).toBeDefined();
  });
});
```

- [ ] **Step 4: Run tests + build + lint** — `npx nx test gridiron-api && npx nx build gridiron-api && npx nx lint gridiron-api`. Expected: PASS (existing gridiron tests + the new wiring spec).

- [ ] **Step 5: Commit**

```bash
git add apps/gridiron-api
git commit -m "refactor(gridiron): adopt inferenceBackboneProviders from substrate-runtime/kit"
```

---

## Task 10: ADR (record the decision)

**Files:**
- Create: `layers/specs/adr/adr-NNN-substrate-composition-kit.md` (next free number — use `/adr-scaffolder` or the `substrate-architect` agent)

- [ ] **Step 1:** Draft a short ADR (status `accepted`) recording: the kit ships as the `@de-braighter/substrate-runtime/kit` subpath (not a third package); it composes existing primitives and authors no kernel concept (charter stance, ADR-176 unaffected); the five helpers; cites this spec. Branch + PR in `layers/specs` (PR-gated). Run `spec-auditor`.

---

## Task 11: Verifier wave + PRs (per repo)

- [ ] **Step 1:** Open the PR in each repo as its tasks complete: `layers/substrate` (kit), `domains/exercir` (kids-football), `domains/gridiron` (gridiron), `layers/specs` (ADR). PR bodies carry `Producer:` + `Effort: standard` + a `cycle-time` `Effect:` line per the workbench convention; end with the Claude Code attribution.
- [ ] **Step 2:** Run the verifier wave on each non-trivial PR (the substrate + exercir PRs): `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` in parallel (worktree isolation); `exercir-charter-checker` joins the exercir PR. **charter-checker must confirm the kit composes-not-authors.**
- [ ] **Step 3:** Drain + post-findings + (after merge) backfill/reconcile per the twin ritual.

---

## Self-review (run against the spec)

- **Spec coverage:** packPreset (T5), dbAuthWiring (T4), inferenceBackboneProviders (T3), selectAdapter (T2), AuthBootstrapBase (T6), subpath home (T1+T7), kids-football migration (T8), gridiron swap (T9), ADR (T10), wave (T11) — all spec deliverables map to a task. ✔
- **Corrections reconciled:** the four grounding corrections are stated up-front and reflected in T3/T4/T6/T8. ✔
- **Type consistency:** `ModuleFragment` shape, `DemoGrant { tenantId, userId, roleId }`, `DB_AUTH_CLIENT`, and the helper signatures are used identically across the kit tasks and the migration tasks. ✔
- **Placeholder scan:** no TBDs; every code step carries real code; relative-import paths flagged "confirm against `substrate.module.ts`" rather than guessed. ✔
