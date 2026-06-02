# Herdbook Mating Planner — Slice 1b (HTTP layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the (already-merged) mating-planner domain over HTTP — a `MatingController` (evaluate / CRUD / lifecycle / offspring-link), its DTOs, the manifest permissions + registrar grant + audit subtypes, the DI wiring, and the bootstrap registration — so the registrar can drive the registry via REST. This makes slice 1a user-reachable; the Angular UI is slice 2.

**Architecture:** A NestJS controller (`@Controller('matings')`) that injects the published `PlannedMatingService` + `MatingEvaluatorService` (slice 1a) and maps their `Result<T,E>` to HTTP, exactly mirroring `animal.controller.ts` / `assessment.controller.ts`. Auth is the existing `@RequiresPermission` + `TenantPackContextGuard` (actor from `request.tenantPackContext.userId`). A `plannedMatingProviders(appRoleClient, tenantPackId)` factory wires the Postgres adapters + services the same way `animalRegistryProviders` does. Zero kernel/pack-domain change — slice 1b is pure `apps/api` composition + the manifest.

**Tech Stack:** TypeScript (ESM `.js` suffixes), NestJS, `@de-braighter/substrate-runtime` (`RequiresPermission`, `AuditService`, `GucPrismaRunner`) + `@de-braighter/substrate-contracts` (`LINEAGE_REPOSITORY`), `herdbook-pack` services, Vitest (controller unit spec with `vi.fn()` doubles + a manifest/bootstrap test; DB-gated wiring spec).

**Spec:** `docs/superpowers/specs/2026-06-02-herdbook-mating-planner-design.md` §5. **Repo:** `domains/herdbook` (branch off `main`). PR-gated.

---

## Real slice-1a service signatures (the contract this slice wraps)

```typescript
// from herdbook-pack (already merged):
MatingEvaluatorService.evaluate(sireKernelId: string, damKernelId: string):
  Promise<Result<MatingEvaluation, MatingEvaluationError>>
// MatingEvaluation = { sireKernelIndividualId, damKernelIndividualId, predictedF, predictedFPct, verdict, thresholds, sharedAncestors[] }
// MatingEvaluationError = { kind: 'invalid-pairing' | 'lineage-failure', message }

PlannedMatingService.create(input: CreatePlannedMatingInput): Promise<Result<{ id: string }, PlannedMatingError>>
// CreatePlannedMatingInput = { sireKernelIndividualId, damKernelIndividualId, plannedDate, notes?, actorUserId }
PlannedMatingService.list(): Promise<PlannedMatingRow[]>
PlannedMatingService.getDetail(id): Promise<Result<PlannedMatingDetail | null, PlannedMatingError>>
PlannedMatingService.updateStatus(id, status: MatingStatus, actorUserId): Promise<Result<void, PlannedMatingError>>
PlannedMatingService.updateNotes(id, notes: string | null, actorUserId): Promise<Result<void, PlannedMatingError>>
PlannedMatingService.linkOffspring(id, offspringKernelId, actorUserId): Promise<Result<void, PlannedMatingError>>
PlannedMatingService.unlinkOffspring(id, offspringKernelId, actorUserId): Promise<Result<void, PlannedMatingError>>
// PlannedMatingError = { kind: 'invalid-pairing' | 'not-found' | 'lineage-failure', ... }
// constructor: new PlannedMatingService(repo, evaluator, lineage, audit, tenantPackId)   ← needs the evaluator
// new MatingEvaluatorService(lineage, settings, tenantPackId)
// new PlannedMatingAuditService(auditService)  ← recordPlanned/recordUpdated
```

`Result<T,E>` = `{ ok: true; value: T } | { ok: false; error: E }`.

---

## File Structure

**Create:**
- `apps/api/src/app/mating.dto.ts` — request DTOs (parse helpers) + `DtoValidationError`.
- `apps/api/src/app/planned-mating.wiring.ts` — `plannedMatingProviders` factory + DI tokens.
- `apps/api/src/app/mating.controller.ts` — the `MatingController`.
- `apps/api/src/app/mating.controller.spec.ts` — controller unit spec (`vi.fn()` service doubles).
- `apps/api/src/app/mating-permissions.spec.ts` — manifest/permission test (the 3 ids exist + registrar has them + the controller's decorator ids resolve).

**Modify:**
- `libs/herdbook-pack/src/manifest/herdbook-manifest.ts` — add 2 audit subtypes + 3 permissions + 3 registrar grants.
- `apps/api/src/app/herdbook-auth.bootstrap.ts` — register `MatingController` in `HERDBOOK_CONTROLLERS` (+ import).
- `apps/api/src/app/app.module.ts` — add `...plannedMatingProviders(...)` (+ import).

**Convention anchors (read to copy style):** `apps/api/src/app/animal.controller.ts` (controller + parse/unwrap/toHttp/actor), `apps/api/src/app/animal.dto.ts` (DTO parse pattern), `apps/api/src/app/animal-registry.wiring.ts` (providers factory + tokens + buildRunner), `apps/api/src/app/herdbook-auth.bootstrap.ts` (HERDBOOK_CONTROLLERS), `apps/api/src/app/animal.controller.spec.ts` (controller unit-spec pattern).

---

## Task 0: Branch and ground

- [ ] **Step 1: Branch**

```bash
cd domains/herdbook
git checkout main && git pull --ff-only
git checkout -b feat/mating-planner-slice1b-http
```

- [ ] **Step 2: Confirm the slice-1a surface + the anchor files exist**

```bash
grep -nE "PlannedMatingService|MatingEvaluatorService|PlannedMatingAuditService|PrismaPlannedMatingAdapter|PrismaSettingReadAdapter|ScopedRunner" libs/herdbook-pack/src/index.ts
ls apps/api/src/app/animal.controller.ts apps/api/src/app/animal.dto.ts apps/api/src/app/animal-registry.wiring.ts apps/api/src/app/herdbook-auth.bootstrap.ts
# Confirm the exact module specifier the existing controllers use to import pack services (herdbook-pack vs @de-braighter/herdbook-pack):
grep -hE "from '(@de-braighter/)?herdbook-pack'" apps/api/src/app/animal.controller.ts | head -1
```

Expected: the slice-1a services exported from the barrel; the anchor files present; note the exact import specifier (use the SAME one in the new files). If `ScopedRunner` is NOT in `index.ts`, check how `animal-registry.wiring.ts` imports it and mirror that.

---

## Task 1: Manifest — permissions + registrar grant + audit subtypes

**Files:** Modify `libs/herdbook-pack/src/manifest/herdbook-manifest.ts`

- [ ] **Step 1: Add the 2 audit subtypes** (in the `auditSubtypes` array, after the last existing entry, matching the `{ packKey: 'herdbook', key, displayName }` shape)

```typescript
    { packKey: 'herdbook', key: 'mating.plan', displayName: 'Mating planned' },
    { packKey: 'herdbook', key: 'mating.update', displayName: 'Mating updated (status / notes / offspring)' },
```

- [ ] **Step 2: Add the 3 permissions** (in the `permissions` array, after the last existing entry, matching `{ id, displayName }`)

```typescript
    { id: 'herdbook.mating.read', displayName: 'Read planned matings + evaluate pairings' },
    { id: 'herdbook.mating.plan', displayName: 'Create planned matings' },
    { id: 'herdbook.mating.update', displayName: 'Update mating status/notes + link offspring' },
```

- [ ] **Step 3: Grant all 3 to the `registrar` role** (append to the `registrar` role's `permissions` array)

```typescript
        'herdbook.mating.read',
        'herdbook.mating.plan',
        'herdbook.mating.update',
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter herdbook-pack run typecheck`
Expected: clean.

```bash
git add libs/herdbook-pack/src/manifest/herdbook-manifest.ts
git commit -m "feat(herdbook): mating manifest — permissions + registrar grant + audit subtypes"
```

---

## Task 2: DTOs

**Files:** Create `apps/api/src/app/mating.dto.ts`

- [ ] **Step 1: Write the DTOs** (mirror `animal.dto.ts` — `Omit<…, 'actorUserId'>` + a manual `DtoValidationError`-throwing parse, caught by the controller's `parse()` → 400)

```typescript
/**
 * REST request DTOs for MatingController. Mirror the pack's view-models but
 * DROP server-derived fields (actorUserId). Parse helpers throw
 * DtoValidationError → the controller maps to 400.
 */
import type { CreatePlannedMatingInput, MatingStatus } from 'herdbook-pack';

export class DtoValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'DtoValidationError';
  }
}

function reqString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new DtoValidationError(field, `${field} is required`);
  }
  return v;
}

function optString(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new DtoValidationError(field, `${field} must be a string`);
  return v;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new DtoValidationError('body', 'request body must be an object');
  }
  return body as Record<string, unknown>;
}

export interface EvaluateMatingRequest {
  sireKernelIndividualId: string;
  damKernelIndividualId: string;
}

export function parseEvaluateMating(body: unknown): EvaluateMatingRequest {
  const b = asObject(body);
  return {
    sireKernelIndividualId: reqString(b['sireKernelIndividualId'], 'sireKernelIndividualId'),
    damKernelIndividualId: reqString(b['damKernelIndividualId'], 'damKernelIndividualId'),
  };
}

/** `POST /matings` body — actor is server-derived. */
export type CreateMatingRequest = Omit<CreatePlannedMatingInput, 'actorUserId'>;

export function parseCreateMating(body: unknown): CreateMatingRequest {
  const b = asObject(body);
  return {
    sireKernelIndividualId: reqString(b['sireKernelIndividualId'], 'sireKernelIndividualId'),
    damKernelIndividualId: reqString(b['damKernelIndividualId'], 'damKernelIndividualId'),
    plannedDate: reqString(b['plannedDate'], 'plannedDate'),
    notes: optString(b['notes'], 'notes'),
  };
}

const MATING_STATUSES: readonly MatingStatus[] = ['planned', 'mated', 'offspring_registered', 'cancelled'];

/** `PATCH /matings/:id` body — at least one of status/notes. */
export interface PatchMatingRequest {
  status?: MatingStatus;
  notes?: string | null;
}

export function parsePatchMating(body: unknown): PatchMatingRequest {
  const b = asObject(body);
  const out: PatchMatingRequest = {};
  if (b['status'] !== undefined) {
    const s = reqString(b['status'], 'status');
    if (!MATING_STATUSES.includes(s as MatingStatus)) {
      throw new DtoValidationError('status', `status must be one of ${MATING_STATUSES.join(', ')}`);
    }
    out.status = s as MatingStatus;
  }
  if ('notes' in b) out.notes = optString(b['notes'], 'notes');
  if (out.status === undefined && out.notes === undefined) {
    throw new DtoValidationError('body', 'at least one of status, notes is required');
  }
  return out;
}

/** `POST /matings/:id/offspring` body. */
export interface LinkOffspringRequest {
  offspringKernelIndividualId: string;
}

export function parseLinkOffspring(body: unknown): LinkOffspringRequest {
  const b = asObject(body);
  return {
    offspringKernelIndividualId: reqString(b['offspringKernelIndividualId'], 'offspringKernelIndividualId'),
  };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter herdbook-api run typecheck` (or the api's typecheck script — check `apps/api/package.json`; if absent use `pnpm --filter herdbook-api exec tsc --noEmit -p tsconfig.json`).
Expected: clean.

```bash
git add apps/api/src/app/mating.dto.ts
git commit -m "feat(herdbook-api): mating request DTOs + parse helpers"
```

---

## Task 3: DI wiring

**Files:** Create `apps/api/src/app/planned-mating.wiring.ts`

- [ ] **Step 1: Write the providers factory** (mirror `animal-registry.wiring.ts`; CRITICAL: `PlannedMatingService` takes the evaluator as its 2nd ctor arg, so construct the evaluator provider first and inject its token into the service provider)

```typescript
/**
 * Planned-mating DI wiring (slice 1b). Binds the Postgres adapters + the pack
 * application services. Under HERDBOOK_KERNEL_DB_AUTH=true the runner is a real
 * GucPrismaRunner over the app-role client; otherwise a fail-fast runner (the
 * @RequiresPermission guard still runs, the data path errors clearly).
 */
import { type Provider } from '@nestjs/common';
import { LINEAGE_REPOSITORY, type LineageRepository } from '@de-braighter/substrate-contracts';
import { AuditService, GucPrismaRunner } from '@de-braighter/substrate-runtime';
import { PrismaClient } from '@prisma/client';
import {
  PlannedMatingService,
  MatingEvaluatorService,
  PlannedMatingAuditService,
  PrismaPlannedMatingAdapter,
  PrismaSettingReadAdapter,
  type ScopedRunner,
} from 'herdbook-pack';
import { AppRolePrismaClient } from './db-backed-auth-wiring.js';

export const PLANNED_MATING_SERVICE = Symbol.for('herdbook/PLANNED_MATING_SERVICE');
export const MATING_EVALUATOR_SERVICE = Symbol.for('herdbook/MATING_EVALUATOR_SERVICE');

class UnavailableRunner implements ScopedRunner {
  run<T>(): Promise<T> {
    return Promise.reject(
      new Error(
        'Mating data path is unavailable in the demo/in-memory posture. Set ' +
          'HERDBOOK_KERNEL_DB_AUTH=true (+ SUBSTRATE_APP_DATABASE_URL + ' +
          'SUBSTRATE_RLS_ENABLED=true) to enable the Postgres-backed mating routes.',
      ),
    );
  }
}

function buildRunner(appRoleClient: AppRolePrismaClient | null): ScopedRunner {
  if (!appRoleClient) return new UnavailableRunner();
  return new GucPrismaRunner(appRoleClient as unknown as PrismaClient) as unknown as ScopedRunner;
}

export function plannedMatingProviders(
  appRoleClient: AppRolePrismaClient | null,
  tenantPackId: string,
): Provider[] {
  const runner = buildRunner(appRoleClient);
  const matingAdapter = new PrismaPlannedMatingAdapter(runner);
  const settingAdapter = new PrismaSettingReadAdapter(runner);

  return [
    {
      provide: MATING_EVALUATOR_SERVICE,
      inject: [LINEAGE_REPOSITORY],
      useFactory: (lineage: LineageRepository) =>
        new MatingEvaluatorService(lineage, settingAdapter, tenantPackId),
    },
    {
      provide: PLANNED_MATING_SERVICE,
      inject: [LINEAGE_REPOSITORY, AuditService, MATING_EVALUATOR_SERVICE],
      useFactory: (
        lineage: LineageRepository,
        audit: AuditService,
        evaluator: MatingEvaluatorService,
      ) =>
        new PlannedMatingService(
          matingAdapter,
          evaluator,
          lineage,
          new PlannedMatingAuditService(audit),
          tenantPackId,
        ),
    },
    { provide: MatingEvaluatorService, useExisting: MATING_EVALUATOR_SERVICE },
    { provide: PlannedMatingService, useExisting: PLANNED_MATING_SERVICE },
  ];
}
```

(If Task 0 found `ScopedRunner` is NOT exported from `herdbook-pack`, import it exactly as `animal-registry.wiring.ts` does, or export it from the pack barrel in a one-line edit to `libs/herdbook-pack/src/index.ts` + commit that with this task.)

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter herdbook-api exec tsc --noEmit -p tsconfig.json`
Expected: clean.

```bash
git add apps/api/src/app/planned-mating.wiring.ts
git commit -m "feat(herdbook-api): planned-mating DI wiring (providers factory)"
```

---

## Task 4: MatingController

**Files:** Create `apps/api/src/app/mating.controller.ts`

- [ ] **Step 1: Write the controller** (mirror `animal.controller.ts` — `parse`/`actor`/`toHttp`; PATCH applies status and/or notes; offspring sub-resource)

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { RequiresPermission } from '@de-braighter/substrate-runtime';
import {
  MatingEvaluatorService,
  PlannedMatingService,
  type MatingEvaluation,
  type PlannedMatingDetail,
  type PlannedMatingRow,
} from 'herdbook-pack';
import {
  DtoValidationError,
  parseCreateMating,
  parseEvaluateMating,
  parseLinkOffspring,
  parsePatchMating,
} from './mating.dto.js';

// Both service error unions share these kinds:
type MatingError = { kind: 'invalid-pairing'; message: string }
  | { kind: 'not-found'; id?: string }
  | { kind: 'lineage-failure'; message: string };
type MatingResult<T> = { ok: true; value: T } | { ok: false; error: MatingError };

@Controller('matings')
export class MatingController {
  constructor(
    private readonly matings: PlannedMatingService,
    private readonly evaluator: MatingEvaluatorService,
    @Inject(REQUEST) private readonly request: { tenantPackContext?: { userId: string } },
  ) {}

  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('herdbook.mating.read')
  async evaluate(@Body() body: unknown): Promise<MatingEvaluation> {
    const req = this.parse(() => parseEvaluateMating(body));
    const result = await this.evaluator.evaluate(req.sireKernelIndividualId, req.damKernelIndividualId);
    return this.unwrap(result);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiresPermission('herdbook.mating.plan')
  async create(@Body() body: unknown): Promise<{ id: string }> {
    const req = this.parse(() => parseCreateMating(body));
    const result = await this.matings.create({ ...req, actorUserId: this.actor() });
    return this.unwrap(result);
  }

  @Get()
  @RequiresPermission('herdbook.mating.read')
  list(): Promise<PlannedMatingRow[]> {
    return this.matings.list();
  }

  @Get(':id')
  @RequiresPermission('herdbook.mating.read')
  async getDetail(@Param('id') id: string): Promise<PlannedMatingDetail> {
    const result = await this.matings.getDetail(id);
    const detail = this.unwrap(result);
    if (detail === null) throw new NotFoundException({ error: 'not-found', message: `mating ${id} not found` });
    return detail;
  }

  @Patch(':id')
  @RequiresPermission('herdbook.mating.update')
  async update(@Param('id') id: string, @Body() body: unknown): Promise<{ ok: true }> {
    const req = this.parse(() => parsePatchMating(body));
    if (req.status !== undefined) {
      this.unwrap(await this.matings.updateStatus(id, req.status, this.actor()));
    }
    if (req.notes !== undefined) {
      this.unwrap(await this.matings.updateNotes(id, req.notes, this.actor()));
    }
    return { ok: true };
  }

  @Post(':id/offspring')
  @HttpCode(HttpStatus.CREATED)
  @RequiresPermission('herdbook.mating.update')
  async linkOffspring(@Param('id') id: string, @Body() body: unknown): Promise<{ ok: true }> {
    const req = this.parse(() => parseLinkOffspring(body));
    this.unwrap(await this.matings.linkOffspring(id, req.offspringKernelIndividualId, this.actor()));
    return { ok: true };
  }

  @Delete(':id/offspring/:animalId')
  @RequiresPermission('herdbook.mating.update')
  async unlinkOffspring(@Param('id') id: string, @Param('animalId') animalId: string): Promise<{ ok: true }> {
    this.unwrap(await this.matings.unlinkOffspring(id, animalId, this.actor()));
    return { ok: true };
  }

  private actor(): string {
    const userId = this.request.tenantPackContext?.userId;
    if (!userId) throw new InternalServerErrorException('no resolved tenant-pack context on request');
    return userId;
  }

  private parse<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof DtoValidationError) {
        throw new BadRequestException({ error: 'validation-failed', message: `${e.field}: ${e.message}` });
      }
      throw e;
    }
  }

  private unwrap<T>(result: MatingResult<T>): T {
    if (result.ok) return result.value;
    throw this.toHttp(result.error);
  }

  private toHttp(error: MatingError): HttpException {
    switch (error.kind) {
      case 'invalid-pairing':
        return new BadRequestException({ error: error.kind, message: error.message });
      case 'not-found':
        return new NotFoundException({ error: error.kind, message: `mating ${error.id ?? ''} not found` });
      case 'lineage-failure':
        return new InternalServerErrorException({ error: error.kind, message: error.message });
    }
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter herdbook-api exec tsc --noEmit -p tsconfig.json`
Expected: clean. (If the `MatingResult`/`MatingError` local types don't structurally accept the services' `Result`/error unions, widen them to match — the service errors are `invalid-pairing`/`not-found`/`lineage-failure`.)

```bash
git add apps/api/src/app/mating.controller.ts
git commit -m "feat(herdbook-api): MatingController — evaluate/CRUD/lifecycle/offspring"
```

---

## Task 5: Controller unit spec

**Files:** Create `apps/api/src/app/mating.controller.spec.ts`

- [ ] **Step 1: Write the failing test** (mirror `animal.controller.spec.ts` — construct the controller directly with `vi.fn()` service doubles + a fake request)

```typescript
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MatingController } from './mating.controller.js';

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = (error: unknown) => ({ ok: false as const, error });

function make(over: Record<string, unknown> = {}) {
  const matings = {
    create: vi.fn(async () => ok({ id: 'm1' })),
    list: vi.fn(async () => [{ id: 'm1' }]),
    getDetail: vi.fn(async () => ok({ id: 'm1', liveKinship: 0.05, offspring: [] })),
    updateStatus: vi.fn(async () => ok(undefined)),
    updateNotes: vi.fn(async () => ok(undefined)),
    linkOffspring: vi.fn(async () => ok(undefined)),
    unlinkOffspring: vi.fn(async () => ok(undefined)),
  };
  const evaluator = { evaluate: vi.fn(async () => ok({ predictedF: 0.05, verdict: 'amber' })) };
  const request = { tenantPackContext: { userId: 'u1' } };
  const ctrl = new MatingController(matings as never, evaluator as never, { ...request, ...over } as never);
  return { ctrl, matings, evaluator };
}

describe('MatingController', () => {
  it('evaluate calls the evaluator and returns the evaluation', async () => {
    const { ctrl, evaluator } = make();
    const r = await ctrl.evaluate({ sireKernelIndividualId: 's', damKernelIndividualId: 'd' });
    expect(evaluator.evaluate).toHaveBeenCalledWith('s', 'd');
    expect(r.verdict).toBe('amber');
  });

  it('create injects the server-derived actor and returns the id', async () => {
    const { ctrl, matings } = make();
    const r = await ctrl.create({ sireKernelIndividualId: 's', damKernelIndividualId: 'd', plannedDate: '2026-06-03' });
    expect(matings.create).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'u1', sireKernelIndividualId: 's' }));
    expect(r.id).toBe('m1');
  });

  it('evaluate rejects an invalid body with 400', async () => {
    const { ctrl } = make();
    await expect(ctrl.evaluate({ sireKernelIndividualId: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('evaluate maps an invalid-pairing error to 400', async () => {
    const { ctrl, evaluator } = make();
    evaluator.evaluate = vi.fn(async () => err({ kind: 'invalid-pairing', message: 'sire must be male' }));
    await expect(ctrl.evaluate({ sireKernelIndividualId: 's', damKernelIndividualId: 'd' })).rejects.toMatchObject({ status: 400 });
  });

  it('getDetail throws 404 when the service returns null', async () => {
    const { ctrl, matings } = make();
    matings.getDetail = vi.fn(async () => ok(null));
    await expect(ctrl.getDetail('missing')).rejects.toMatchObject({ status: 404 });
  });

  it('patch applies both status and notes when present', async () => {
    const { ctrl, matings } = make();
    await ctrl.update('m1', { status: 'mated', notes: 'bred 2026-06-03' });
    expect(matings.updateStatus).toHaveBeenCalledWith('m1', 'mated', 'u1');
    expect(matings.updateNotes).toHaveBeenCalledWith('m1', 'bred 2026-06-03', 'u1');
  });

  it('unlinkOffspring passes the path params + actor', async () => {
    const { ctrl, matings } = make();
    await ctrl.unlinkOffspring('m1', 'kid-1');
    expect(matings.unlinkOffspring).toHaveBeenCalledWith('m1', 'kid-1', 'u1');
  });

  it('throws 500 when no tenant-pack context (actor) is resolved', async () => {
    const { ctrl } = make({ tenantPackContext: undefined });
    await expect(ctrl.create({ sireKernelIndividualId: 's', damKernelIndividualId: 'd', plannedDate: '2026-06-03' }))
      .rejects.toMatchObject({ status: 500 });
  });
});
```

- [ ] **Step 2: Run → FAIL** (controller not yet wired / import). Then it should PASS once Task 4 is in place.

Run: `pnpm --filter herdbook-api exec vitest run src/app/mating.controller.spec.ts`
Expected: 8 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/app/mating.controller.spec.ts
git commit -m "test(herdbook-api): MatingController unit spec (routing + actor + error mapping)"
```

---

## Task 6: Register the controller + providers

**Files:** Modify `apps/api/src/app/herdbook-auth.bootstrap.ts` + `apps/api/src/app/app.module.ts`

- [ ] **Step 1: Register `MatingController`** in `herdbook-auth.bootstrap.ts`

Add the import (alongside the other controller imports):
```typescript
import { MatingController } from './mating.controller.js';
```
Add to the `HERDBOOK_CONTROLLERS` array (after `PhotoController,`):
```typescript
  MatingController,
```

- [ ] **Step 2: Wire the providers** in `app.module.ts`

Add the import (alongside the other `*Providers` imports):
```typescript
import { plannedMatingProviders } from './planned-mating.wiring.js';
```
Add to the `providers: [...]` array (after `...photoProviders(appRoleClient, HERDBOOK_TENANT_PACK_ID),`):
```typescript
    ...plannedMatingProviders(appRoleClient, HERDBOOK_TENANT_PACK_ID),
```

- [ ] **Step 3: Verify the app module compiles + the bootstrap accepts the new permissions**

Run: `pnpm --filter herdbook-api exec vitest run src/app/app.module.spec.ts` (if present) and `pnpm --filter herdbook-api exec tsc --noEmit -p tsconfig.json`.
Expected: clean. (The `HerdbookAuthBootstrap` validates the controller's `@RequiresPermission('herdbook.mating.*')` ids against the manifest at bootstrap — Task 1 added them, so validation passes. If `app.module.spec.ts` boots the module, it will fail-fast on a dangling permission id, proving the wiring.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app/herdbook-auth.bootstrap.ts apps/api/src/app/app.module.ts
git commit -m "feat(herdbook-api): register MatingController + planned-mating providers"
```

---

## Task 7: Manifest/permission integration test

**Files:** Create `apps/api/src/app/mating-permissions.spec.ts`

This pins that the controller's decorator ids exist in the manifest + the registrar is granted them (the bootstrap's runtime validation, asserted as a unit test).

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it } from 'vitest';
import { HERDBOOK_MANIFEST } from 'herdbook-pack';

describe('mating manifest wiring', () => {
  const permIds = new Set(HERDBOOK_MANIFEST.permissions.map((p) => p.id));
  const registrar = HERDBOOK_MANIFEST.roles.find((r) => r.id === 'registrar');
  const auditKeys = new Set(HERDBOOK_MANIFEST.auditSubtypes.map((a) => a.key));

  it('declares the 3 mating permissions', () => {
    for (const id of ['herdbook.mating.read', 'herdbook.mating.plan', 'herdbook.mating.update']) {
      expect(permIds.has(id)).toBe(true);
    }
  });

  it('grants all 3 mating permissions to the registrar role', () => {
    expect(registrar).toBeDefined();
    for (const id of ['herdbook.mating.read', 'herdbook.mating.plan', 'herdbook.mating.update']) {
      expect(registrar!.permissions).toContain(id);
    }
  });

  it('declares the mating audit subtypes', () => {
    expect(auditKeys.has('mating.plan')).toBe(true);
    expect(auditKeys.has('mating.update')).toBe(true);
  });
});
```

(If `HERDBOOK_MANIFEST` is exported under a different name, use the one the manifest file exports — check `libs/herdbook-pack/src/index.ts`.)

- [ ] **Step 2: Run → PASS**

Run: `pnpm --filter herdbook-api exec vitest run src/app/mating-permissions.spec.ts`
Expected: 3 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/app/mating-permissions.spec.ts
git commit -m "test(herdbook-api): mating manifest permissions + registrar grant + audit subtypes"
```

---

## Task 8: Green the gate + live-verify against the running stack

**Files:** none (verification)

- [ ] **Step 1: Local gate**

Run: `pnpm --filter herdbook-api run build` (or `exec tsc -p tsconfig.json`), `pnpm --filter herdbook-api exec vitest run src/app/mating.controller.spec.ts src/app/mating-permissions.spec.ts`, and `pnpm --filter herdbook-pack exec vitest run` (manifest typecheck/tests).
Expected: all green.

- [ ] **Step 2: Live-verify the new endpoints** (the running API holds a stale build; rebuild + restart, then curl with the dev-auth headers)

The herdbook API is running on :3200 (DB-backed). To pick up the new controller it must be rebuilt + restarted (restarting also releases the Windows DLL lock so `db:generate` can run if needed):
```bash
# stop the running api (find + kill the node on :3200) — German netstat: column is ABHÖREN
netstat -ano | grep 3200    # note the PID
taskkill //F //PID <pid>
# rebuild + restart DB-backed
pnpm --filter herdbook-api run build
HERDBOOK_KERNEL_DB_AUTH=true SUBSTRATE_APP_DATABASE_URL="postgresql://app:app@localhost:5433/herdbook?schema=herdbook" SUBSTRATE_RLS_ENABLED=true PORT=3200 pnpm --filter herdbook-api run dev &
sleep 4
# evaluate the two seeded animals (CH-CORR-DAM is female; needs a male sire — expect a clean invalid-pairing 400 OR a verdict if you pick a valid pair). At minimum confirm the route exists + auth works:
curl -s -o /dev/null -w "GET /api/matings -> %{http_code}\n" -H "x-tenant-id: b6c5d8e2-0001-4abc-9def-fedcba000001" -H "x-pack-id: herdbook" -H "x-user-id: 11111111-1111-4111-8111-111111111111" http://localhost:3200/matings
# expect 200 (registrar has herdbook.mating.read) — a header-less call returns 403 (guard), proving auth is wired.
```
Expected: `GET /matings -> 200` with the dev headers (empty list `[]` is fine — no matings seeded). A header-less curl returns 403. This proves the controller is mapped, the providers resolve, and the permission is granted.

- [ ] **Step 3: Commit** (nothing to commit — verification only). If you created a `.env`-style change, do NOT commit it.

---

## Self-Review (completed by plan author)

- **Spec coverage (§5):** §5.1 endpoints — evaluate ✅ T4, POST/GET /matings ✅ T4, GET/:id ✅ T4, PATCH ✅ T4 (status+notes), POST/DELETE offspring ✅ T4; actor server-derived ✅ T4 (`actor()`). §5.2 permissions (read/plan/update) ✅ T1 + registrar grant ✅ T1 + audit subtypes ✅ T1; controller registered in HERDBOOK_CONTROLLERS ✅ T6. Wiring ✅ T3/T6. Deferred (correctly out of 1b): the Angular UI (slice 2), the mate recommender, the register-offspring shortcut.
- **Placeholder scan:** none — full code + commands. (Task 0 flags the two unknowns to confirm live: the exact `herdbook-pack` import specifier + whether `ScopedRunner`/`HERDBOOK_MANIFEST` are barrel-exported — these are *verify-then-match*, not placeholders.)
- **Type consistency:** the controller uses the real slice-1a signatures (`evaluate(sire,dam)`→`MatingEvaluation`; `create(CreatePlannedMatingInput)`→`{id}`; `updateStatus(id,status,actor)`; `linkOffspring(id,offspringKernelId,actor)`); the `PlannedMatingService` is constructed with the evaluator as the 2nd arg in T3 (matching its ctor); error kinds (`invalid-pairing`/`not-found`/`lineage-failure`) are consistent across the controller `toHttp` and the service unions.

---

## Remaining slices (roadmap)

| Slice | Builds |
|-------|--------|
| **2 — UI** | Angular "Matings" nav: planner (sire/dam pickers → live `POST /matings/evaluate` card with verdict + shared ancestors → `POST /matings`), list (`GET /matings`), detail (`GET /matings/:id` — lifecycle `PATCH` + offspring link + predicted-vs-actual); animal-detail "plan a mating" entry; a11y verdict glyph + sr-word. |
| (later) | mate recommender (rank candidates by lowest predicted F); register-offspring create shortcut; threshold-editing UI + the `db:setup` threshold seed. |
