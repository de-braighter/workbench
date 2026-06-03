# Drill Library — Define / Search / Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A kids-football coach can DEFINE a new drill (name + description + metadata + diagram), SEARCH the library by text + facets (equipment, age), and DISPLAY a drill's prose objective alongside its diagram — built on the existing browse + diagram-authoring surface.

**Architecture:** 3 slices = 3 PRs. Slice 1 (backend): `name`/`description` on the drill metadata, `CreateDrillUseCase` + `POST /pack-football/drills` (tenant-tier, in-memory, mirroring `forkTemplate`), enriched `DrillWire` (+ `description` + `requirements`), `toWire` tier-marker fix. Slice 2 (frontend search/display): enrich the client + `DrillBibliothekComponent` with text search + equipment/age filters + description/requirements in the detail panel. Slice 3 (frontend define): `DrillCreateFormComponent` → `POST /drills` → open the existing diagram editor.

**Tech Stack:** NestJS 10 + Zod (backend use-case/controller), Vitest + `@nestjs/testing`, Angular 21 (signals, standalone, OnPush, zoneless) + Vitest/TestBed (frontend), the existing `DrillCatalogClient` / `DrillBibliothekComponent` / `DrillBoardEditorComponent`.

**Spec:** `docs/superpowers/specs/2026-06-04-drill-library-define-search-display-design.md`

---

## Key existing signatures (verified 2026-06-04)

- Repo contract `libs/pack-football/src/out-ports/intervention-catalog.repository.ts`: `InterventionCatalogRepository` has `listDrills`, `findInterventionByKey`, `createTemplate`, `forkTemplate(sourceKey): Promise<TemplateMutationResult>`, `updateDrillDiagram`. Token `INTERVENTION_CATALOG_REPOSITORY`. `TemplateMutationResult = { ok:true; value:Intervention } | { ok:false; error:TemplateMutationFailure }`.
- `ManifestInterventionCatalogRepository` (`out-ports/manifest-intervention-catalog.repository.ts`): tenant delta = `tenantTier: Map<id,Intervention>`, `tenantTierKeys: Set<key>`, `diagramOverrides: Map<key,DrillDiagram>`. `allInterventions()` = manifest ∪ tenantTier values. `forkTemplate` builds `{ id: randomUUID(), key: '<src>.fork.<8>', metadata: {...src, forkedFrom:{id,key}}, effects:[...] }` and adds to `tenantTier` + `tenantTierKeys`.
- `Intervention` (`manifest/intervention.types.ts`): `{ id, key, kind, subCatalog, metadata: { tier: 'vendor'(literal), requirements?: RequirementsMetadata, diagram?: DrillDiagram, ...passthrough }, effects }`. `RequirementsMetadata = { minPlayers?, maxPlayers?, equipment?: string[], ageBands?: string[], ... }`.
- Controller `apps/pack-football-api/src/app/pack-football-drills.controller.ts`: `DrillWire = { key, name, phase, intensity, tier, diagram }`. `toWire` derives `tier = meta.forkedFrom === undefined ? meta.tier : 'tenant'` and `name = drillDisplayName(key)`. Constructor `@Inject(LIST_DRILLS_USE_CASE/FORK_TEMPLATE_USE_CASE/UPDATE_DRILL_DIAGRAM_USE_CASE)`. `@RequiresPermission(FOOTBALL_PERMISSIONS.drillWrite)` on writes.
- Fork use-case pattern (`in-ports/fork-template.use-case.ts`): Zod request schema + response interface + `*Failure` union + `*Result` + interface + DI `Symbol`. Service in `application/`.
- Client `libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts`: `DrillCatalogEntry = { key, name, phase, intensity, tier, diagram }`, `listDrills(filter?, signal?)`, `forkDrill`, `saveDrillDiagram`, `DrillCatalogClientError`. Parses via `parseOrFail(DrillsEnvelopeSchema, ...)`.
- `DrillBibliothekComponent`: `entries = signal<DrillCatalogEntry[]>`, `filter = signal<{phase,intensity}>`, `filteredEntries`/`groupedEntries`/`allPhases`/`allIntensities` computeds, `effectiveSelected`, detail panel renders `entry.name` + pills + `<lib-drill-board-scene>`.
- Use-case test harness: `@nestjs/testing` `Test.createTestingModule({ providers: [Service, ManifestInterventionCatalogRepository, { provide: INTERVENTION_CATALOG_REPOSITORY, useExisting: ManifestInterventionCatalogRepository }, ...] })`.

---

## SLICE 1 — Backend: name/description + create + enriched wire

**PR:** `feat(pack-football): drill name/description + CreateDrill + POST /drills (#NN)`

### Task 1.1 — `createDrill` on the repository contract + manifest adapter

**Files:**
- Modify: `libs/pack-football/src/out-ports/intervention-catalog.repository.ts`
- Modify: `libs/pack-football/src/out-ports/manifest-intervention-catalog.repository.ts`
- Test: `libs/pack-football/src/out-ports/manifest-intervention-catalog.repository.spec.ts` (add cases; or the existing spec)

- [ ] **Step 1: Add the input type + method to the contract.** In `intervention-catalog.repository.ts` add:

```typescript
export interface CreateDrillInput {
  name: string;
  description?: string;
  phase: string;
  intensity: string;
  requirements?: {
    minPlayers?: number;
    maxPlayers?: number;
    equipment?: string[];
    ageBands?: string[];
  };
  diagram?: DrillDiagram;
}
```
And on `InterventionCatalogRepository`:
```typescript
  /**
   * Registers a brand-new tenant-tier drill (sub-catalog 'drill'). Mints a
   * `football.intervention.drill.custom.<shortUuid>` key, stores it in the
   * tenant delta (sibling to forkTemplate), and stamps `metadata.origin =
   * 'custom'` so `toWire` reports `tier: 'tenant'`. Returns the created row.
   */
  createDrill(input: CreateDrillInput): Promise<Intervention>;
```
(Import `DrillDiagram` if not already in scope.)

- [ ] **Step 2: Write the failing adapter test.** In the manifest repo spec:

```typescript
it('createDrill registers a tenant-tier custom drill surfaced by listDrills', async () => {
  const repo = new ManifestInterventionCatalogRepository();
  const created = await repo.createDrill({
    name: 'Rondo 4v2',
    description: 'Ballbesitz im Quadrat',
    phase: 'technique',
    intensity: 'moderate',
    requirements: { minPlayers: 6, equipment: ['Hütchen'], ageBands: ['U10'] },
  });
  expect(created.key.startsWith('football.intervention.drill.custom.')).toBe(true);
  expect(created.subCatalog).toBe('drill');
  expect((created.metadata as Record<string, unknown>)['origin']).toBe('custom');
  expect((created.metadata as Record<string, unknown>)['name']).toBe('Rondo 4v2');
  expect((created.metadata as Record<string, unknown>)['description']).toBe('Ballbesitz im Quadrat');
  const all = await repo.listDrills();
  expect(all.some((d) => d.key === created.key)).toBe(true);
});
```

- [ ] **Step 3: Run — expect FAIL** (`createDrill` not implemented).
Run: `npx nx test pack-football`

- [ ] **Step 4: Implement `createDrill` in the manifest adapter.** Mirror `forkTemplate`:

```typescript
async createDrill(input: CreateDrillInput): Promise<Intervention> {
  const id = randomUUID();
  const key = `football.intervention.drill.custom.${randomUUID().slice(0, 8)}`;
  const drill: Intervention = {
    id,
    key,
    kind: 'intervention',
    subCatalog: 'drill',
    metadata: {
      tier: 'vendor', // schema-pinned literal; origin marks the real tier
      origin: 'custom',
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      phase: input.phase,
      intensity: input.intensity,
      ...(input.requirements !== undefined ? { requirements: input.requirements } : {}),
      ...(input.diagram !== undefined ? { diagram: input.diagram } : {}),
    },
    effects: [],
  };
  this.tenantTier.set(drill.id, drill);
  this.tenantTierKeys.add(drill.key);
  if (input.diagram !== undefined) this.diagramOverrides.set(drill.key, input.diagram);
  return drill;
}
```
(`kind: 'intervention'` — confirm the literal matches `InterventionKindSchema`; if it's a different literal, use the manifest's drill `kind`.)

- [ ] **Step 5: Run — expect PASS.** `npx nx test pack-football`

- [ ] **Step 6: Commit.**
```bash
git add libs/pack-football/src/out-ports/
git commit -m "feat(pack-football): createDrill on the catalog repository (tenant-tier custom drill)"
```

### Task 1.2 — `CreateDrillUseCase` + service

**Files:**
- Create: `libs/pack-football/src/in-ports/create-drill.use-case.ts`
- Create: `libs/pack-football/src/application/create-drill.service.ts`
- Create: `libs/pack-football/src/application/create-drill.service.spec.ts`
- Modify: the pack barrel (`libs/pack-football/src/index.ts`) to export the use-case + token.

- [ ] **Step 1: Write the in-port** (`create-drill.use-case.ts`) mirroring fork-template:

```typescript
import { z } from 'zod';
import { DrillDiagramSchema, type DrillDiagram } from '@de-braighter/pack-football-contracts';

export const CreateDrillRequestSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  phase: z.string().min(1),
  intensity: z.string().min(1),
  requirements: z
    .object({
      minPlayers: z.number().int().positive().optional(),
      maxPlayers: z.number().int().positive().optional(),
      equipment: z.array(z.string()).optional(),
      ageBands: z.array(z.string()).optional(),
    })
    .optional(),
  diagram: DrillDiagramSchema.optional(),
});
export type CreateDrillRequest = z.infer<typeof CreateDrillRequestSchema>;

export interface CreateDrillResponse {
  key: string;
  name: string;
  phase: string;
  intensity: string;
  tier: 'tenant';
  description: string | null;
  diagram: DrillDiagram | null;
}

export type CreateDrillFailure = { kind: 'invalid-input'; detail: string };
export type CreateDrillResult =
  | { ok: true; value: CreateDrillResponse }
  | { ok: false; error: CreateDrillFailure };

export interface CreateDrillUseCase {
  createDrill(request: CreateDrillRequest): Promise<CreateDrillResult>;
}

export const CREATE_DRILL_USE_CASE = Symbol('CREATE_DRILL_USE_CASE');
```

- [ ] **Step 2: Write the failing service test** (`create-drill.service.spec.ts`):

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ManifestInterventionCatalogRepository } from '../out-ports/manifest-intervention-catalog.repository.js';
import { INTERVENTION_CATALOG_REPOSITORY } from '../out-ports/intervention-catalog.repository.js';
import { CreateDrillService } from './create-drill.service.js';

async function build() {
  const m: TestingModule = await Test.createTestingModule({
    providers: [
      CreateDrillService,
      ManifestInterventionCatalogRepository,
      { provide: INTERVENTION_CATALOG_REPOSITORY, useExisting: ManifestInterventionCatalogRepository },
    ],
  }).compile();
  return { svc: m.get(CreateDrillService), repo: m.get(ManifestInterventionCatalogRepository) };
}

describe('CreateDrillService', () => {
  it('creates a tenant-tier drill and surfaces it via the repo', async () => {
    const { svc, repo } = await build();
    const r = await svc.createDrill({ name: 'Rondo', phase: 'technique', intensity: 'moderate' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tier).toBe('tenant');
    expect(r.value.name).toBe('Rondo');
    const fetched = await repo.findInterventionByKey(r.value.key);
    expect(fetched).not.toBeNull();
  });

  it('rejects an empty name as invalid-input', async () => {
    const { svc } = await build();
    const r = await svc.createDrill({ name: '  ', phase: 'technique', intensity: 'moderate' } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid-input');
  });
});
```

- [ ] **Step 3: Run — expect FAIL.** `npx nx test pack-football`

- [ ] **Step 4: Implement the service** (`create-drill.service.ts`):

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  CreateDrillRequestSchema,
  type CreateDrillRequest,
  type CreateDrillResult,
  type CreateDrillUseCase,
} from '../in-ports/create-drill.use-case.js';
import {
  INTERVENTION_CATALOG_REPOSITORY,
  type InterventionCatalogRepository,
} from '../out-ports/intervention-catalog.repository.js';

@Injectable()
export class CreateDrillService implements CreateDrillUseCase {
  constructor(
    @Inject(INTERVENTION_CATALOG_REPOSITORY)
    private readonly repo: InterventionCatalogRepository,
  ) {}

  async createDrill(request: CreateDrillRequest): Promise<CreateDrillResult> {
    const parsed = CreateDrillRequestSchema.safeParse(request);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error: { kind: 'invalid-input', detail: `${issue?.path.join('.') ?? '<root>'}: ${issue?.message ?? 'invalid'}` },
      };
    }
    const created = await this.repo.createDrill(parsed.data);
    const meta = created.metadata as Record<string, unknown>;
    return {
      ok: true,
      value: {
        key: created.key,
        name: String(meta['name'] ?? ''),
        phase: String(meta['phase'] ?? ''),
        intensity: String(meta['intensity'] ?? ''),
        tier: 'tenant',
        description: typeof meta['description'] === 'string' ? meta['description'] : null,
        diagram: (meta['diagram'] as never) ?? null,
      },
    };
  }
}
```

- [ ] **Step 5: Run — expect PASS.** `npx nx test pack-football`

- [ ] **Step 6: Export from the barrel.** In `libs/pack-football/src/index.ts` add exports for `CREATE_DRILL_USE_CASE`, `CreateDrillUseCase` (type), `CreateDrillRequest`/`Response`/`Result` types, and `CreateDrillService` — mirror how `FORK_TEMPLATE_USE_CASE` + `ForkTemplateService` are exported (grep `FORK_TEMPLATE_USE_CASE` in index.ts).

- [ ] **Step 7: Commit.**
```bash
git add libs/pack-football/src/in-ports/create-drill.use-case.ts libs/pack-football/src/application/create-drill.service.ts libs/pack-football/src/application/create-drill.service.spec.ts libs/pack-football/src/index.ts
git commit -m "feat(pack-football): CreateDrillUseCase + service"
```

### Task 1.3 — `POST /pack-football/drills` + enrich `toWire`

**Files:**
- Modify: `apps/pack-football-api/src/app/pack-football-drills.controller.ts`
- Modify: `apps/pack-football-api/src/app/pack-football-drills.controller.spec.ts` (find the existing spec; if none, create it next to the controller)
- Modify: `apps/pack-football-api/src/app/app.module.ts` (provide `CREATE_DRILL_USE_CASE` → `CreateDrillService`)

- [ ] **Step 1: Enrich `DrillWire` + `toWire`.** In the controller:
```typescript
export interface DrillWire {
  key: string;
  name: string;
  phase: string;
  intensity: string;
  tier: string;
  description: string | null;
  requirements: { minPlayers?: number; maxPlayers?: number; equipment: string[]; ageBands: string[] } | null;
  diagram: DrillDiagram | null;
}
```
Update `toWire`:
```typescript
const meta = intervention.metadata as {
  tier: string; origin?: string; name?: string; description?: string;
  phase?: string; intensity?: string; diagram?: DrillDiagram;
  forkedFrom?: unknown; requirements?: { minPlayers?: number; maxPlayers?: number; equipment?: string[]; ageBands?: string[] };
};
// tenant signal = forked OR custom-created.
const tier = (meta.forkedFrom !== undefined || meta.origin === 'custom') ? 'tenant' : meta.tier;
const req = meta.requirements;
return {
  key: intervention.key,
  name: typeof meta.name === 'string' && meta.name.length > 0 ? meta.name : drillDisplayName(intervention.key),
  phase: meta.phase ?? '',
  intensity: meta.intensity ?? '',
  tier,
  description: typeof meta.description === 'string' ? meta.description : null,
  requirements: req ? { minPlayers: req.minPlayers, maxPlayers: req.maxPlayers, equipment: req.equipment ?? [], ageBands: req.ageBands ?? [] } : null,
  diagram: meta.diagram ?? null,
};
```

- [ ] **Step 2: Write the failing controller test** for `POST /drills` (supertest over the AppModule, mirroring the fork test in the existing controller spec): assert 201/200 returns a wire with `tier: 'tenant'`, the posted `name`/`description`, and that a follow-up `GET /drills` includes the new key. Also a 400 for empty name. (Mirror the existing `forkDrill` test's harness.)

- [ ] **Step 3: Run — expect FAIL.** `npx nx test pack-football-api` (or the api vitest config).

- [ ] **Step 4: Add the create handler + DI.** Inject `CREATE_DRILL_USE_CASE`:
```typescript
@Post('drills')
@RequiresPermission(FOOTBALL_PERMISSIONS.drillWrite)
async createDrill(@Body() rawBody: unknown): Promise<DrillWire> {
  const parsed = CreateDrillRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new HttpException({ kind: 'invalid-input', detail: parsed.error.issues[0]?.message ?? 'invalid' }, HttpStatus.BAD_REQUEST);
  }
  const result = await this.createUseCase.createDrill(parsed.data);
  if (!result.ok) throw new HttpException(result.error, HttpStatus.BAD_REQUEST);
  // Echo the full enriched wire — re-read so requirements/description are present.
  const created = await /* listDrills find by key OR map result.value */ ...;
  return /* toWire(created) or build from result.value */;
}
```
Pragmatic: build the `DrillWire` directly from `result.value` (it has key/name/phase/intensity/tier/description/diagram) + the posted `requirements`. Add `CreateDrillRequestSchema` + `CREATE_DRILL_USE_CASE` + `CreateDrillUseCase` to the imports from `'pack-football'`, and the constructor `@Inject(CREATE_DRILL_USE_CASE) private readonly createUseCase: CreateDrillUseCase`.
In `app.module.ts` add the provider `{ provide: CREATE_DRILL_USE_CASE, useClass: CreateDrillService }` (mirror the fork provider).

- [ ] **Step 5: Run — expect PASS.** `npx nx test pack-football-api`

- [ ] **Step 6: Commit.**
```bash
git add apps/pack-football-api/src/app/
git commit -m "feat(pack-football-api): POST /pack-football/drills + enrich DrillWire (description+requirements+custom-tier)"
```

### Task 1.4 — Slice 1 PR + wave + merge

- [ ] Run `npx nx run-many -t lint test --projects=pack-football,pack-football-api`.
- [ ] PR `feat(pack-football): drill create + enriched wire (#NN)`. Verifier wave (local-ci + reviewer + charter-checker + qa-engineer + exercir-charter-checker). Merge on green. Twin ritual.

---

## SLICE 2 — Frontend: search + display

**PR:** `feat(pack-football-ui): drill text search + equipment/age filters + description in detail (#NN)`

### Task 2.1 — Enrich the client + wire mirror

**Files:** `libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts` (+ its spec).
- [ ] Add `description: string | null` + `requirements: { minPlayers?: number; maxPlayers?: number; equipment: string[]; ageBands: string[] } | null` to `DrillCatalogEntry` and to the `DrillsEnvelopeSchema`/entry Zod schema (defensive parse — default `requirements` to null + empty arrays, `description` to null). Update the `listDrills` map to surface them.
- [ ] Add `createDrill(input, signal?)` → `POST /pack-football/drills` (mirror `forkDrill`'s dispatch; parse the returned `DrillWire` with a Zod schema). Input type mirrors `CreateDrillRequest` (name/description/phase/intensity/requirements/diagram?).
- [ ] Tests: listDrills parses description+requirements (incl. the absent→null/[] defaults); createDrill posts the body + parses the response; createDrill error → `DrillCatalogClientError`.
- [ ] Commit.

### Task 2.2 — Text search + facet filters + detail enrichment in `DrillBibliothekComponent`

**Files:** `drill-bibliothek.component.ts` (+ spec).
- [ ] Add `query = signal('')` (text), `equipmentFilter = signal<string[]>([])`, `ageFilter = signal<string[]>([])`. Add `allEquipment`/`allAgeBands` computeds (union over `entries()` requirements). Extend `filteredEntries` to AND: phase, intensity, `query` (case-insensitive substring over `name` + `description`), equipment (entry has ALL selected? or ANY? — use ANY-overlap: entry passes if it has at least one selected equipment; same for age), .
- [ ] Template: a search `<input data-testid="drill-search">` bound to `query`; equipment + age `<select multiple>` / chip toggles bound to the filter signals; detail panel adds `<p data-testid="drill-detail-description">{{ entry.description }}</p>` (when present) + a requirements block (equipment/age/players).
- [ ] Tests: typing in search narrows the grouped list (matches name; matches description); equipment filter narrows; age filter narrows; filters combine with phase/intensity; detail renders description + requirements; empty-result state. axe no-violations (reuse the repo convention).
- [ ] Commit.

### Task 2.3 — Slice 2 PR + wave + merge (include a11y-pro).

---

## SLICE 3 — Frontend: define (create form)

**PR:** `feat(pack-football-ui): drill create form → POST /drills → diagram editor (#NN)`

### Task 3.1 — `DrillCreateFormComponent`

**Files:** Create `libs/pack-football-ui/src/lib/drills/drill-create-form.component.ts` (+ spec).
- [ ] Reactive form (use `/reactive-forms-cva-governance` patterns): `name` (required), `description` (textarea, optional), `phase` (select, required), `intensity` (select, required), `equipment` (add-chip list), `minPlayers`/`maxPlayers` (number, optional), `ageBands` (multi-select, optional). Inputs: `phases`/`intensities` option lists (or derive from a constant). Output: `created = output<string>()` (the new drill key) + `cancelled = output<void>()`.
- [ ] On submit: build the `CreateDrillRequest`, call `inject(DrillCatalogClient).createDrill(input)`. On success → `created.emit(key)`. On `DrillCatalogClientError` → inline error via `describeSubstrateClientFailure`-style helper (check the drills failure-describe helper).
- [ ] Tests: name-required validation blocks submit; valid submit calls createDrill with the right payload; success emits `created(key)`; failure surfaces inline German copy; cancel emits `cancelled`. a11y: labels associated, error announced.
- [ ] Commit.

### Task 3.2 — Wire the create entry point in `DrillBibliothekComponent`

**Files:** `drill-bibliothek.component.ts` (+ spec).
- [ ] Add `creating = signal(false)` + a `<button data-action="new-drill">Neuer Drill</button>`. When `creating()`, render `<lib-drill-create-form (created)="onDrillCreated($event)" (cancelled)="creating.set(false)">` in the detail panel (instead of the placeholder/selected detail).
- [ ] `onDrillCreated(key)`: reload the list (re-fetch `listDrills`), select the new drill by key, set `creating=false` and `editing=true` (open the existing `DrillEditorPanelComponent`/diagram editor for the new drill so the coach draws the diagram).
- [ ] Tests: clicking "Neuer Drill" shows the form; `created` reloads + selects the new drill + opens the editor; cancel returns to the library.
- [ ] Commit.

### Task 3.3 — Slice 3 PR + wave + merge (include a11y-pro). Twin ritual.

---

## Self-review

- **Spec coverage:** D1 (name/description) → Task 1.1/1.3. D2 (CreateDrill + POST) → Tasks 1.1–1.3 + 3.1–3.2. D3 (client-side search) → Task 2.2. D4 (in-memory) → Task 1.1 (tenant delta). D5 (vendor-tier safe) → Task 1.1 (only writes tenantTier). Tier-marker fix → Task 1.1 (`origin:'custom'`) + 1.3 (`toWire`). ✓ All covered.
- **Placeholder scan:** Task 1.3 Step 4 has a `...` for the echo-wire construction — RESOLVED inline: build the `DrillWire` from `result.value` + posted `requirements` (don't re-read). The `kind: 'intervention'` literal in 1.1 Step 4 must match `InterventionKindSchema` — verify by grepping the manifest's drill rows.
- **Type consistency:** `CreateDrillRequest` (in-port) is reused by the controller + client; `CreateDrillResponse.tier: 'tenant'` is consistent; `requirements` shape `{minPlayers?,maxPlayers?,equipment[],ageBands[]}` consistent across repo input / wire / client / form. ✓
- **Open verification for the implementer:** (a) `InterventionKindSchema` literal for a drill row (`'intervention'` assumed); (b) exact barrel export style for use-cases in `pack-football/src/index.ts`; (c) the api project's vitest config / test command; (d) the drills failure-describe helper name in pack-football-ui.
