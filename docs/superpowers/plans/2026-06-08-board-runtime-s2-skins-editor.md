# Board Runtime S2 — Skins into the Drill Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the drill editor to skin-parity with the read-only scene, add a toolbar skin dropdown, and persist the chosen skin per drill (`metadata.skin`) so the Drill Library renders each drill in its own skin instead of a hardwired `matchday`.

**Architecture:** Skin name becomes a closed enum in `pack-football-contracts` (wire-validatable); the visual definitions stay UI-side. The skin rides the drill's `metadata` passthrough (no DB migration — persistence is in-memory maps), threaded through the existing `PUT /drills/:key/diagram` save (widened to `{ diagram, skin }`). The editor reaches parity by reusing two extracted pure helpers (`stripeBands`, `markerFilter`) plus the existing `resolveSkin`/glyph/layout modules; the generic component extraction is deferred to S3. The editor component defaults to `schematic` (byte-preserving its unit tests); the panel seeds `matchday`/the saved skin into the running app.

**Tech Stack:** TypeScript, Zod, Angular 21 (standalone, signals, zoneless, OnPush), NestJS 10, Vitest, Nx 22.

**Repo:** `domains/exercir` (run all `nx`/`npm` commands from that directory). Branch off `main`: `git checkout -b feat/board-runtime-s2-skins-editor main`.

**Conventions to honour (from the codebase):**
- ESM imports use explicit `.js` extensions.
- i18n: German is source-of-truth; the typed `BOARD_MESSAGES_DE` map mirrors `i18n/de/board.json`; `board-i18n.parity.spec.ts` asserts equality; `en/board.json` must stay key-parity (no empty values). `boardMsg(key)` falls through to the key on a miss.
- The UI cannot import the `pack-football` NestJS barrel (esbuild rejects NestJS/class-validator). It imports platform-agnostic schemas from `@de-braighter/pack-football-contracts` (a workspace-local lib, NOT the published substrate) and mirrors via `data/wire-schemas.ts`.
- Verify with `npx nx build <project>`; do NOT use `preview_*` browser tools here (only `preview_start`/`preview_stop` work on this machine).
- TDD: write the failing test, see it fail, implement minimally, see it pass, commit. Frequent commits.

**Definitions reused across tasks (do not redefine):**
- The four skin names, canonical order: `['schematic', 'matchday', 'telestrator', 'arena']`.
- The contract schema/type: `DrillBoardSkinSchema` (a `z.enum`) and `DrillBoardSkinName` (Task 1).
- The shared render helpers: `stripeBands(skin, viewport)` and `markerFilter(skin)` (Task 7).

---

## Slice S2.1 — Skin enum in contracts + backend persistence & wire threading (no UI behaviour change)

### Task 1: Add `DrillBoardSkinSchema` to pack-football-contracts

**Files:**
- Modify: `libs/pack-football-contracts/src/lib/drill-diagram.schemas.ts` (append at end)
- Modify: `libs/pack-football-contracts/src/index.ts`
- Test: `libs/pack-football-contracts/src/lib/drill-diagram.schemas.spec.ts` (create or append)

- [ ] **Step 1: Write the failing test**

Append to (or create) `libs/pack-football-contracts/src/lib/drill-diagram.schemas.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { DrillBoardSkinSchema } from './drill-diagram.schemas.js';

describe('DrillBoardSkinSchema', () => {
  it('accepts the four known skin names', () => {
    for (const name of ['schematic', 'matchday', 'telestrator', 'arena']) {
      expect(DrillBoardSkinSchema.safeParse(name).success).toBe(true);
    }
  });

  it('rejects an unknown skin name', () => {
    expect(DrillBoardSkinSchema.safeParse('neon-dream').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`DrillBoardSkinSchema` not exported)

Run: `npx nx test pack-football-contracts`
Expected: FAIL — cannot find `DrillBoardSkinSchema`.

- [ ] **Step 3: Implement** — append to `libs/pack-football-contracts/src/lib/drill-diagram.schemas.ts`:

```typescript
/**
 * Closed set of drill-board skin names. The contract owns the *set* (wire-
 * validatable); the per-skin visual definitions live UI-side in
 * `pack-football-ui` `generation/drill-board-skins.ts`. Skin is display
 * policy carried on the drill's `metadata`, orthogonal to the geometry above.
 */
export const DrillBoardSkinSchema = z.enum([
  'schematic',
  'matchday',
  'telestrator',
  'arena',
]);
export type DrillBoardSkinName = z.infer<typeof DrillBoardSkinSchema>;
```

Add to the barrel `libs/pack-football-contracts/src/index.ts`, inside the existing drill-diagram export block (the one re-exporting `DrillDiagramSchema` from `./lib/drill-diagram.schemas.js`):

```typescript
  DrillBoardSkinSchema,
  type DrillBoardSkinName,
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx nx test pack-football-contracts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-contracts/src/lib/drill-diagram.schemas.ts libs/pack-football-contracts/src/lib/drill-diagram.schemas.spec.ts libs/pack-football-contracts/src/index.ts
git commit -m "feat(pack-football-contracts): DrillBoardSkinSchema closed enum (S2.1)"
```

---

### Task 2: Re-export the skin enum through the domain + pack barrels

**Files:**
- Modify: `libs/pack-football/src/domain/football-event.ts` (the existing drill-diagram re-export block, ~lines 278–287)
- Modify: `libs/pack-football/src/index.ts` (the pack barrel — wherever `DrillDiagramSchema` is re-exported)

- [ ] **Step 1: Extend the football-event re-export.** In `libs/pack-football/src/domain/football-event.ts`, add to the `export { … } from '@de-braighter/pack-football-contracts';` block that currently lists `DrillDiagramSchema`:

```typescript
  DrillBoardSkinSchema,
  type DrillBoardSkinName,
```

- [ ] **Step 2: Extend the pack barrel.** Open `libs/pack-football/src/index.ts`, find where `DrillDiagramSchema` is exported (it is imported by the API controller via `from 'pack-football'`), and add `DrillBoardSkinSchema` + `type DrillBoardSkinName` alongside it (same source module). If `DrillDiagramSchema` is re-exported via `export * from './domain/football-event.js'` then no edit is needed here — verify by grep:

Run: `npx nx build pack-football`
Expected: builds (no behaviour change yet).

- [ ] **Step 3: Verify the symbol is reachable from the barrel.** Add a throwaway check (then delete it):

Run: `node -e "import('pack-football').then(m => console.log(typeof m.DrillBoardSkinSchema))"` — only if a built entry exists; otherwise rely on Task 6's compile. If unsure, skip and let Task 6's controller compile prove reachability.

- [ ] **Step 4: Commit**

```bash
git add libs/pack-football/src/domain/football-event.ts libs/pack-football/src/index.ts
git commit -m "feat(pack-football): re-export DrillBoardSkinSchema through domain + pack barrels (S2.1)"
```

---

### Task 3: Add `skin?` to the metadata + update-diagram request schemas

**Files:**
- Modify: `libs/pack-football/src/manifest/intervention.types.ts` (`InterventionSchema.metadata`)
- Modify: `libs/pack-football/src/in-ports/update-drill-diagram.use-case.ts` (`UpdateDrillDiagramRequestSchema`)
- Test: `libs/pack-football/src/in-ports/update-drill-diagram.use-case.spec.ts` (create or append)

- [ ] **Step 1: Write the failing test** — append to (or create) `libs/pack-football/src/in-ports/update-drill-diagram.use-case.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { UpdateDrillDiagramRequestSchema } from './update-drill-diagram.use-case.js';

const DIAGRAM = {
  sceneKind: 'pack-football.drill-diagram.v1',
  schemaVersion: 'pack-football.drill-diagram.v1',
  dots: [],
  arrows: [],
};

describe('UpdateDrillDiagramRequestSchema skin', () => {
  it('accepts an optional skin', () => {
    const parsed = UpdateDrillDiagramRequestSchema.safeParse({
      drillKey: 'football.intervention.drill.mine.fork.x',
      diagram: DIAGRAM,
      skin: 'telestrator',
    });
    expect(parsed.success).toBe(true);
  });

  it('still accepts a request without skin', () => {
    const parsed = UpdateDrillDiagramRequestSchema.safeParse({
      drillKey: 'football.intervention.drill.mine.fork.x',
      diagram: DIAGRAM,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown skin', () => {
    const parsed = UpdateDrillDiagramRequestSchema.safeParse({
      drillKey: 'football.intervention.drill.mine.fork.x',
      diagram: DIAGRAM,
      skin: 'bogus',
    });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`skin: 'bogus'` currently passes because `skin` is unknown → ignored, so the third assertion fails)

Run: `npx nx test pack-football`
Expected: FAIL on "rejects an unknown skin".

- [ ] **Step 3: Implement.**

In `libs/pack-football/src/in-ports/update-drill-diagram.use-case.ts`, change the import line:

```typescript
import { DrillDiagramSchema, DrillBoardSkinSchema } from '../domain/football-event.js';
```

and add `skin` to the schema:

```typescript
export const UpdateDrillDiagramRequestSchema = z.object({
  drillKey: z
    .string()
    .regex(/^football\.intervention\.drill\.[a-z0-9_-]+(\.[a-z0-9_-]+)*$/),
  diagram: DrillDiagramSchema,
  skin: DrillBoardSkinSchema.optional(),
});
```

In `libs/pack-football/src/manifest/intervention.types.ts`, change the import:

```typescript
import { DrillDiagramSchema, DrillBoardSkinSchema } from '../domain/football-event.js';
```

and add `skin` to the metadata object:

```typescript
  metadata: z
    .object({
      tier: z.literal('vendor'),
      requirements: RequirementsMetadataSchema.optional(),
      diagram: DrillDiagramSchema.optional(),
      skin: DrillBoardSkinSchema.optional(),
    })
    .passthrough(),
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx nx test pack-football`
Expected: PASS (and no other pack-football specs regress).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football/src/in-ports/update-drill-diagram.use-case.ts libs/pack-football/src/in-ports/update-drill-diagram.use-case.spec.ts libs/pack-football/src/manifest/intervention.types.ts
git commit -m "feat(pack-football): metadata.skin + update-diagram request skin (S2.1)"
```

---

### Task 4: Thread skin through the out-port + in-memory repository

**Files:**
- Modify: `libs/pack-football/src/out-ports/intervention-catalog.repository.ts` (interface + import)
- Modify: `libs/pack-football/src/out-ports/manifest-intervention-catalog.repository.ts` (impl)
- Test: `libs/pack-football/src/out-ports/manifest-intervention-catalog.repository.spec.ts` (append)

- [ ] **Step 1: Write the failing test** — append a `describe` to `manifest-intervention-catalog.repository.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { ManifestInterventionCatalogRepository } from './manifest-intervention-catalog.repository.js';

const DIAGRAM = {
  sceneKind: 'pack-football.drill-diagram.v1' as const,
  schemaVersion: 'pack-football.drill-diagram.v1' as const,
  dots: [],
  arrows: [],
};

describe('ManifestInterventionCatalogRepository skin override', () => {
  it('stores and surfaces a skin on a tenant drill via updateDrillDiagram', async () => {
    const repo = new ManifestInterventionCatalogRepository();
    const created = await repo.createDrill({
      name: 'Mine',
      phase: 'warmup',
      intensity: 'easy',
    });
    const res = await repo.updateDrillDiagram(created.key, DIAGRAM, 'telestrator');
    expect(res.ok).toBe(true);
    const drills = await repo.listDrills();
    const mine = drills.find((d) => d.key === created.key);
    expect((mine?.metadata as { skin?: string }).skin).toBe('telestrator');
  });

  it('leaves skin absent when none is provided', async () => {
    const repo = new ManifestInterventionCatalogRepository();
    const created = await repo.createDrill({ name: 'NoSkin', phase: 'warmup', intensity: 'easy' });
    await repo.updateDrillDiagram(created.key, DIAGRAM);
    const drills = await repo.listDrills();
    const mine = drills.find((d) => d.key === created.key);
    expect((mine?.metadata as { skin?: string }).skin).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`updateDrillDiagram` takes only 2 args)

Run: `npx nx test pack-football`
Expected: FAIL — type error / skin undefined.

- [ ] **Step 3: Implement the out-port interface.** In `libs/pack-football/src/out-ports/intervention-catalog.repository.ts`:

Change the import from `intervention.types.js` to also pull `DrillBoardSkinName`:

```typescript
import {
  EffectDeclarationSchema,
  SubCatalogSchema,
  type DrillBoardSkinName,
  type EffectDeclaration,
  type Intervention,
  type RehaSubtreeLibrary,
  type RequirementsMetadata,
  type SubCatalog,
} from '../manifest/intervention.types.js';
```

(If `intervention.types.ts` does not export `DrillBoardSkinName`, add `export type { DrillBoardSkinName } from '../domain/football-event.js';` near its other type exports — it is already imported there as a value via `DrillBoardSkinSchema` in Task 3, so re-exporting the type is a one-liner.)

Widen the interface method signature:

```typescript
  updateDrillDiagram(
    drillKey: string,
    diagram: DrillDiagram,
    skin?: DrillBoardSkinName,
  ): Promise<DrillDiagramUpdateResult>;
```

- [ ] **Step 4: Implement the in-memory repository.** In `libs/pack-football/src/out-ports/manifest-intervention-catalog.repository.ts`:

Add the import:

```typescript
import {
  type Intervention,
  type RehaSubtreeLibrary,
  type SubCatalog,
  type DrillBoardSkinName,
} from '../manifest/intervention.types.js';
```

Add the override map next to `diagramOverrides`:

```typescript
  /** Per-drill skin overrides authored through the S2 skin picker. */
  private readonly skinOverrides = new Map<string, DrillBoardSkinName>();
```

Widen `updateDrillDiagram` and store the skin (after the tier check, alongside the diagram set):

```typescript
  async updateDrillDiagram(
    drillKey: string,
    diagram: DrillDiagram,
    skin?: DrillBoardSkinName,
  ): Promise<DrillDiagramUpdateResult> {
    const target = this.allInterventions().find((i) => i.key === drillKey);
    if (!target) {
      return { ok: false, error: { kind: 'drill-not-found', drillKey } };
    }
    if (target.subCatalog !== 'drill') {
      return { ok: false, error: { kind: 'not-a-drill', drillKey } };
    }
    if (!this.tenantTierKeys.has(drillKey)) {
      return { ok: false, error: { kind: 'forbidden-vendor-tier', drillKey } };
    }
    this.diagramOverrides.set(drillKey, diagram);
    if (skin !== undefined) {
      this.skinOverrides.set(drillKey, skin);
    }
    return { ok: true, value: this.withDiagramOverride(target) };
  }
```

Extend `withDiagramOverride` to merge the skin override too:

```typescript
  private withDiagramOverride(intervention: Intervention): Intervention {
    const diagramOverride = this.diagramOverrides.get(intervention.key);
    const skinOverride = this.skinOverrides.get(intervention.key);
    if (!diagramOverride && !skinOverride) return intervention;
    return {
      ...intervention,
      metadata: {
        ...intervention.metadata,
        ...(diagramOverride ? { diagram: diagramOverride } : {}),
        ...(skinOverride ? { skin: skinOverride } : {}),
      },
    };
  }
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx nx test pack-football`
Expected: PASS (new + existing repo specs green).

- [ ] **Step 6: Commit**

```bash
git add libs/pack-football/src/out-ports/intervention-catalog.repository.ts libs/pack-football/src/out-ports/manifest-intervention-catalog.repository.ts libs/pack-football/src/out-ports/manifest-intervention-catalog.repository.spec.ts
git commit -m "feat(pack-football): persist drill skin override in catalog repo (S2.1)"
```

---

### Task 5: Pass skin from the application service to the repository

**Files:**
- Modify: `libs/pack-football/src/application/update-drill-diagram.service.ts`
- Test: `libs/pack-football/src/application/update-drill-diagram.service.spec.ts` (append)

- [ ] **Step 1: Write the failing test** — append to the existing service spec a case asserting the repo receives the skin. Match the existing spec's mock style (read the file first to mirror its `catalog`/`publisher`/`prisma` test doubles). The new case:

```typescript
it('forwards the request skin to the catalog repository', async () => {
  // ARRANGE: build the service with mock catalog/publisher/prisma exactly as the
  // existing tests in this file do (copy their beforeEach wiring). The catalog
  // mock's updateDrillDiagram should resolve ok with a drill Intervention.
  const skinSpy = vi.fn().mockResolvedValue({
    ok: true,
    value: { id: 'i1', key: 'football.intervention.drill.mine.fork.x', kind: 'intervention', subCatalog: 'drill', metadata: { tier: 'vendor' }, effects: [] },
  });
  catalog.updateDrillDiagram = skinSpy;

  await service.updateDrillDiagram(
    { tenantId: 't1', actorRef: { kind: 'person', id: 'u1' } },
    {
      drillKey: 'football.intervention.drill.mine.fork.x',
      diagram: { sceneKind: 'pack-football.drill-diagram.v1', schemaVersion: 'pack-football.drill-diagram.v1', dots: [], arrows: [] },
      skin: 'arena',
    },
  );

  expect(skinSpy).toHaveBeenCalledWith(
    'football.intervention.drill.mine.fork.x',
    expect.anything(),
    'arena',
  );
});
```

(If the existing spec's `catalog`/`service` variables differ, adapt names to match — the assertion is what matters: the 3rd argument is `'arena'`.)

- [ ] **Step 2: Run it — expect FAIL** (service calls repo with 2 args)

Run: `npx nx test pack-football`
Expected: FAIL — 3rd arg `undefined`, not `'arena'`.

- [ ] **Step 3: Implement.** In `update-drill-diagram.service.ts`, pass the parsed skin:

```typescript
    const repoResult = await this.catalog.updateDrillDiagram(
      parsed.data.drillKey,
      parsed.data.diagram,
      parsed.data.skin,
    );
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx nx test pack-football`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football/src/application/update-drill-diagram.service.ts libs/pack-football/src/application/update-drill-diagram.service.spec.ts
git commit -m "feat(pack-football): service forwards skin to catalog repo (S2.1)"
```

---

### Task 6: Accept + surface skin at the HTTP boundary

**Files:**
- Modify: `apps/pack-football-api/src/app/pack-football-drills.controller.ts`
- Test: `apps/pack-football-api/src/app/pack-football-drills.controller.spec.ts` (append; if absent, create following the existing controller-spec style in that folder)

- [ ] **Step 1: Write the failing test** — assert `toWire` surfaces `metadata.skin` and the body schema accepts skin. Append:

```typescript
import { describe, expect, it } from 'vitest';
import { toWire } from './pack-football-drills.controller.js';

describe('toWire skin', () => {
  it('surfaces metadata.skin on the wire', () => {
    const wire = toWire({
      id: 'i1',
      key: 'football.intervention.drill.mine.fork.x',
      kind: 'intervention',
      subCatalog: 'drill',
      metadata: { tier: 'vendor', origin: 'custom', name: 'Mine', skin: 'arena' },
      effects: [],
    } as never);
    expect(wire.skin).toBe('arena');
  });

  it('defaults skin to null when absent', () => {
    const wire = toWire({
      id: 'i2',
      key: 'football.intervention.drill.warm_rondo',
      kind: 'intervention',
      subCatalog: 'drill',
      metadata: { tier: 'vendor' },
      effects: [],
    } as never);
    expect(wire.skin).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`wire.skin` does not exist)

Run: `npx nx test pack-football-api`
Expected: FAIL — property `skin` missing.

- [ ] **Step 3: Implement.** In `pack-football-drills.controller.ts`:

Add to the `pack-football` import list: `DrillBoardSkinSchema`, `type DrillBoardSkinName`.

Add `skin` to the `DrillWire` interface:

```typescript
export interface DrillWire {
  key: string;
  name: string;
  phase: string;
  intensity: string;
  tier: string;
  description: string | null;
  requirements: { /* unchanged */ } | null;
  diagram: DrillDiagram | null;
  skin: DrillBoardSkinName | null;
}
```

In `toWire`, extend the `meta` cast with `skin?: DrillBoardSkinName;` and add `skin: meta.skin ?? null,` to the returned object (next to `diagram`).

Widen the body schema and pass skin to the use-case:

```typescript
const UpdateDiagramBodySchema = z.object({
  diagram: DrillDiagramSchema,
  skin: DrillBoardSkinSchema.optional(),
});
```

```typescript
    const result = await this.updateUseCase.updateDrillDiagram(actor, {
      drillKey,
      diagram: parsed.data.diagram,
      skin: parsed.data.skin,
    });
```

Add `skin: null,` to the object the `createDrill` handler returns (the create flow does not author a skin; new drills fall back to `matchday` at render).

- [ ] **Step 4: Run it — expect PASS**

Run: `npx nx test pack-football-api`
Expected: PASS.

- [ ] **Step 5: Build the API to prove barrel reachability + types**

Run: `npx nx build pack-football-api`
Expected: builds (this also proves Task 2's barrel export).

- [ ] **Step 6: Commit**

```bash
git add apps/pack-football-api/src/app/pack-football-drills.controller.ts apps/pack-football-api/src/app/pack-football-drills.controller.spec.ts
git commit -m "feat(pack-football-api): accept + surface drill skin on the wire (S2.1)"
```

---

## Slice S2.2 — Extract shared skin-render helpers; refactor the scene onto them

### Task 7: Create `drill-board-skin-render.ts` (pure helpers)

**Files:**
- Create: `libs/pack-football-ui/src/lib/generation/drill-board-skin-render.ts`
- Test: `libs/pack-football-ui/src/lib/generation/drill-board-skin-render.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { markerFilter, stripeBands } from './drill-board-skin-render.js';
import { resolveSkin } from './drill-board-skins.js';

describe('stripeBands', () => {
  it('returns no bands for a grass-less skin', () => {
    expect(stripeBands(resolveSkin('schematic'), { width: 600, height: 360 })).toEqual([]);
  });

  it('returns alternating even bands for a grass skin', () => {
    const bands = stripeBands(resolveSkin('matchday'), { width: 600, height: 360 });
    // 8 stripes over height 360 → band height 45; even indices only → 4 bands.
    expect(bands).toHaveLength(4);
    expect(bands[0]).toEqual({ i: 0, y: 0, h: 45 });
    expect(bands[1]).toEqual({ i: 2, y: 90, h: 45 });
  });
});

describe('markerFilter', () => {
  it('returns the glow filter when the skin glows', () => {
    expect(markerFilter(resolveSkin('telestrator'))).toBe('url(#skin-glow)');
  });
  it('returns the shadow filter for a rich non-glow skin', () => {
    expect(markerFilter(resolveSkin('matchday'))).toBe('url(#skin-shadow)');
  });
  it('returns null for the flat schematic skin', () => {
    expect(markerFilter(resolveSkin('schematic'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module does not exist)

Run: `npx nx test pack-football-ui --test-file=drill-board-skin-render.spec.ts` (or `npx nx test pack-football-ui` and find the failure)
Expected: FAIL — cannot resolve `./drill-board-skin-render.js`.

- [ ] **Step 3: Implement** — `libs/pack-football-ui/src/lib/generation/drill-board-skin-render.ts`. Move the exact logic from `DrillBoardSceneComponent.stripeBands` + `.markerFilter` into pure functions:

```typescript
/**
 * Pure skin-render helpers shared by the read-only drill scene and the drill
 * editor (S2). Single-sources the surface/marker decisions so the two
 * renderers cannot drift. The generic renderer component itself is deferred to
 * S3 (per the board-runtime epic, ADR-176 promote-on-2nd-consumer).
 */
import type { DrillBoardSkin } from './drill-board-skins.js';
import type { DrillViewport } from './drill-board.types.js';

export interface StripeBand {
  i: number;
  y: number;
  h: number;
}

/** Alternating (even-index) mow-stripe bands across the pitch height. */
export function stripeBands(skin: DrillBoardSkin, viewport: DrillViewport): StripeBand[] {
  const n = skin.surface.stripeCount;
  if (!skin.surface.grass || n <= 0) return [];
  const h = viewport.height / n;
  return Array.from({ length: n }, (_, i) => ({ i, y: i * h, h })).filter(
    (b) => b.i % 2 === 0,
  );
}

/** The SVG filter URL for a marker under this skin, or null when flat. */
export function markerFilter(skin: DrillBoardSkin): string | null {
  if (skin.surface.glow !== 'none') return 'url(#skin-glow)';
  if (skin.surface.richMarkers) return 'url(#skin-shadow)';
  return null;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx nx test pack-football-ui`
Expected: PASS (the new spec passes; nothing else touched yet).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-skin-render.ts libs/pack-football-ui/src/lib/generation/drill-board-skin-render.spec.ts
git commit -m "feat(pack-football-ui): extract pure skin-render helpers (S2.2)"
```

---

### Task 8: Refactor the scene onto the shared helpers (byte-preserved)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts`

- [ ] **Step 1: Confirm the scene specs are green before touching it**

Run: `npx nx test pack-football-ui`
Expected: PASS (baseline — the scene render is verified by its existing spec).

- [ ] **Step 2: Refactor.** In `drill-board-scene.component.ts`:

Add the import:

```typescript
import { markerFilter, stripeBands } from './drill-board-skin-render.js';
```

Replace the component's `stripeBands` computed body to delegate (keep the computed so the template binding `stripeBands()` is unchanged):

```typescript
  readonly stripeBands = computed(() => stripeBands(this.activeSkin(), this.viewport()));
```

Replace the `markerFilter` method body to delegate:

```typescript
  protected markerFilter(skin: DrillBoardSkin): string | null {
    return markerFilter(skin);
  }
```

(Both keep their existing names/signatures so the template is untouched. The local `DrillBoardSkin` import stays for the `markerFilter` param type.)

- [ ] **Step 3: Run the scene specs — expect PASS (byte-identical output)**

Run: `npx nx test pack-football-ui`
Expected: PASS — no scene-render assertion changes.

- [ ] **Step 4: Build the lib**

Run: `npx nx build pack-football-ui`
Expected: builds.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts
git commit -m "refactor(pack-football-ui): scene consumes shared skin-render helpers (S2.2)"
```

---

## Slice S2.3 — Editor reaches skin-parity; client + Library read the saved skin

### Task 9: Single-source `DrillBoardSkinName` from contracts (UI side)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-skins.ts`
- Modify: `libs/pack-football-ui/src/lib/data/wire-schemas.ts`

- [ ] **Step 1: Re-home the type.** In `drill-board-skins.ts`, replace:

```typescript
export type DrillBoardSkinName = 'schematic' | 'matchday' | 'telestrator' | 'arena';
```

with a re-export from contracts, plus the canonical name list used by the picker:

```typescript
import {
  DrillBoardSkinSchema,
  type DrillBoardSkinName,
} from '@de-braighter/pack-football-contracts';

export type { DrillBoardSkinName };

/** Canonical picker order; derived from the contract enum so it cannot drift. */
export const SKIN_NAMES = DrillBoardSkinSchema.options as readonly DrillBoardSkinName[];
```

(Leave `SKINS`, `resolveSkin`, `DrillBoardSkin`, `DotStyle`, etc. unchanged — they keep keying off the UI-local `DrillDotKind`/`DrillArrowKind`.)

- [ ] **Step 2: Mirror in wire-schemas.** In `data/wire-schemas.ts`, add to the existing `export { … } from '@de-braighter/pack-football-contracts';` drill-diagram block:

```typescript
  DrillBoardSkinSchema,
  type DrillBoardSkinName,
```

- [ ] **Step 3: Build — expect PASS (type-only change)**

Run: `npx nx build pack-football-ui`
Expected: builds (scene still imports `DrillBoardSkinName` from `drill-board-skins.js`, which now re-exports it).

- [ ] **Step 4: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-skins.ts libs/pack-football-ui/src/lib/data/wire-schemas.ts
git commit -m "refactor(pack-football-ui): single-source DrillBoardSkinName from contracts (S2.3)"
```

---

### Task 10: Client carries skin (entry + save payload)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts`
- Modify: `libs/pack-football-ui/src/lib/data/wire-schemas.ts` (`CreateDrillResponseSchema`)
- Test: `libs/pack-football-ui/src/lib/drills/drill-catalog.client.spec.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `drill-catalog.client.spec.ts` (mirror its existing `fetchImpl` stub style):

```typescript
it('listDrills surfaces entry.skin', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ drills: [{
      key: 'football.intervention.drill.mine.fork.x', name: 'Mine',
      phase: 'warmup', intensity: 'easy', tier: 'tenant', skin: 'arena',
      diagram: { sceneKind: 'pack-football.drill-diagram.v1', schemaVersion: 'pack-football.drill-diagram.v1', dots: [], arrows: [] },
    }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  const client = new DrillCatalogClient();
  client.configure({ baseUrl: 'http://x', fetchImpl });
  const [entry] = await client.listDrills();
  expect(entry.skin).toBe('arena');
});

it('saveDrillDiagram sends the skin in the body', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ drillKey: 'k', updatedAt: '2026-06-08T00:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  const client = new DrillCatalogClient();
  client.configure({ baseUrl: 'http://x', fetchImpl });
  const diagram = { sceneKind: 'pack-football.drill-diagram.v1', schemaVersion: 'pack-football.drill-diagram.v1', dots: [], arrows: [] } as const;
  await client.saveDrillDiagram('football.intervention.drill.mine.fork.x', diagram, 'telestrator');
  const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
  expect(body.skin).toBe('telestrator');
  expect(body.diagram).toEqual(diagram);
});
```

- [ ] **Step 2: Run — expect FAIL** (`entry.skin` undefined; body has no `skin`)

Run: `npx nx test pack-football-ui`
Expected: FAIL on both.

- [ ] **Step 3: Implement.** In `drill-catalog.client.ts`:

Add the import (from the wire mirror):

```typescript
import {
  // …existing…
  DrillBoardSkinSchema,
  type DrillBoardSkinName,
} from '../data/wire-schemas.js';
```

Add `skin` to `DrillCatalogEntry`:

```typescript
export interface DrillCatalogEntry {
  // …existing fields…
  skin: DrillBoardSkinName | null;
}
```

Add `skin` to the local `DrillWireSchema`:

```typescript
  // presentation (S2); legacy rows omit it
  skin: DrillBoardSkinSchema.nullish(),
```

Map it in `listDrills` (add to the returned object) and `createDrill` (returned object) as `skin: entry.skin ?? null` / `skin: wire.skin ?? null`.

Widen `saveDrillDiagram` to send skin:

```typescript
  async saveDrillDiagram(
    drillKey: string,
    diagram: DrillDiagram,
    skin?: DrillBoardSkinName,
    signal?: AbortSignal,
  ): Promise<UpdateDrillDiagramResponse> {
    const requestId = mintRequestId();
    const url = `${this.config.baseUrl}/pack-football/drills/${encodeURIComponent(drillKey)}/diagram`;
    const response = await this.dispatch(
      url,
      requestId,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(skin === undefined ? { diagram } : { diagram, skin }),
      },
      signal,
    );
    return parseOrFail(UpdateDrillDiagramResponseSchema, response.body, requestId);
  }
```

In `data/wire-schemas.ts`, add `skin: DrillBoardSkinSchema.nullish(),` to `CreateDrillResponseSchema` (import `DrillBoardSkinSchema` — already re-exported in this file from Task 9 Step 2, so reference it directly).

- [ ] **Step 4: Run — expect PASS**

Run: `npx nx test pack-football-ui`
Expected: PASS (existing client specs still green — `saveDrillDiagram` callers passing 2 args still compile because `skin` is optional).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts libs/pack-football-ui/src/lib/drills/drill-catalog.client.spec.ts libs/pack-football-ui/src/lib/data/wire-schemas.ts
git commit -m "feat(pack-football-ui): client carries drill skin (entry + save) (S2.3)"
```

---

### Task 11: Editor renders the active skin (parity), default `schematic`

**Files:**
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts`
- Test: `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts` (append new skin cases; leave existing cases untouched)

> **Byte-preservation contract:** the editor input `skin` defaults to `'schematic'`. Existing editor specs mount the component WITHOUT a `skin` input, so they keep rendering schematic (current look). The dot interaction attributes (`data-dot`, `data-dot-id`, `role="button"`, `tabindex`, `[aria-label]`, `[aria-grabbed]`, `(pointerdown)`) MUST be present on every glyph branch (circle / jersey / cone / ball) so interaction + a11y specs pass under any skin.

- [ ] **Step 1: Write the failing tests** — append to the editor spec:

```typescript
import { resolveSkin } from './drill-board-skins.js';

const ONE_PLAYER = {
  sceneKind: 'pack-football.drill-diagram.v1',
  schemaVersion: 'pack-football.drill-diagram.v1',
  dots: [{ id: 'd1', kind: 'pack-football.drill-diagram.player', x: 10, y: 10, label: '7' }],
  arrows: [],
};

it('renders grass under the matchday skin', () => {
  const f = TestBed.createComponent(DrillBoardEditorComponent);
  f.componentRef.setInput('diagram', ONE_PLAYER);
  f.componentRef.setInput('skin', 'matchday');
  f.detectChanges();
  expect((f.nativeElement as HTMLElement).querySelector('[data-grass]')).toBeTruthy();
});

it('renders NO grass under the schematic skin (default look preserved)', () => {
  const f = TestBed.createComponent(DrillBoardEditorComponent);
  f.componentRef.setInput('diagram', ONE_PLAYER);
  f.detectChanges(); // no skin input → schematic
  expect((f.nativeElement as HTMLElement).querySelector('[data-grass]')).toBeNull();
});

it('a labelled player keeps its dot interactive (role=button) under matchday', () => {
  const f = TestBed.createComponent(DrillBoardEditorComponent);
  f.componentRef.setInput('diagram', ONE_PLAYER);
  f.componentRef.setInput('skin', 'matchday');
  f.detectChanges();
  const dot = (f.nativeElement as HTMLElement).querySelector('[data-dot][role="button"]');
  expect(dot).toBeTruthy();
});

it('per-skin SR-number gating: aria-label has the number under matchday, not under schematic', () => {
  const mf = TestBed.createComponent(DrillBoardEditorComponent);
  mf.componentRef.setInput('diagram', ONE_PLAYER);
  mf.componentRef.setInput('skin', 'matchday');
  mf.detectChanges();
  const mAria = (mf.nativeElement as HTMLElement).querySelector('[data-dot]')?.getAttribute('aria-label') ?? '';
  expect(mAria).toContain('7');

  const sf = TestBed.createComponent(DrillBoardEditorComponent);
  sf.componentRef.setInput('diagram', ONE_PLAYER);
  sf.detectChanges(); // schematic
  const sAria = (sf.nativeElement as HTMLElement).querySelector('[data-dot]')?.getAttribute('aria-label') ?? '';
  expect(sAria).not.toContain('Nr.');
});
```

- [ ] **Step 2: Run — expect FAIL** (`data-grass` never rendered; aria has no number)

Run: `npx nx test pack-football-ui`
Expected: FAIL on the grass + number assertions.

- [ ] **Step 3: Implement the component class wiring.**

Imports — add:

```typescript
import { jerseyPath } from './drill-board-glyphs.js';
import { markerFilter, stripeBands } from './drill-board-skin-render.js';
import {
  SKINS,
  SKIN_NAMES,
  resolveSkin,
  type DrillBoardSkin,
  type DrillBoardSkinName,
} from './drill-board-skins.js';
```

Remove the now-unused `drill-board-style.js` symbols you replace (`DOT_COLORS`, `DOT_STROKE`, `ARROW_STROKE`, `ARROW_DASH`, `ARROW_WIDTH`) from the import — keep `ARROW_KINDS`, `DOT_KINDS`. Import `conePoints` from `./drill-board-glyphs.js` (matching the scene) instead of `./drill-board-style.js`.

Add the input/output + skin signal (mirror the diagram seed-effect pattern):

```typescript
  readonly skin = input<DrillBoardSkinName>('schematic');
  readonly skinChange = output<DrillBoardSkinName>();

  private readonly skinSig = signal<DrillBoardSkinName>('schematic');
  readonly activeSkin = computed(() => resolveSkin(this.skinSig()));

  protected readonly skinNames = SKIN_NAMES;
```

In the constructor, add a seed effect next to the diagram one:

```typescript
    effect(() => {
      const s = this.skin(); // tracked — re-seeds when the input changes
      untracked(() => this.skinSig.set(s));
    });
```

Make `view()` skin-aware (the SR-number gate):

```typescript
  readonly view = computed(() =>
    layoutDrillBoard(boardGeometryToDrillDiagram(this.store.workingGeometry()), this.viewport(), {
      numbersForKind: (kind) => this.activeSkin().dot[kind].number,
    }),
  );
```

Add the skin-change handler + i18n messages (the i18n keys land in Task 14; reference them now):

```typescript
  onSkinChange(name: DrillBoardSkinName): void {
    this.skinSig.set(name);
    this.skinChange.emit(name);
    this.announce.set(skinChangedLabel(name));
  }
```

Add template helpers for the glyph branches (mirror the scene):

```typescript
  protected jerseyPath(cx: number, cy: number, w: number): string { return jerseyPath(cx, cy, w); }
  protected markerFilter(skin: DrillBoardSkin): string | null { return markerFilter(skin); }
  protected readonly stripeBands = computed(() => stripeBands(this.activeSkin(), this.viewport()));
  protected readonly jerseyW = 16;
  protected skinLabel(name: DrillBoardSkinName): string { return skinLabel(name); }
```

Delete the now-unused `dotFill` / `dotStroke` / `arrowColor` / `arrowDash` / `arrowWidth` methods (replaced by skin reads in the template).

- [ ] **Step 4: Implement the template.** Update the SVG to read from `activeSkin()` (call `@let skin = activeSkin();` at the top of the `<svg>`), mirroring the scene:

  - `<defs>`: keep the arrowhead markers but set `[attr.fill]="skin.arrow[kind].stroke"`. Add the glow filter (when `skin.surface.glow !== 'none'`) + the `skin-ball`/`skin-cone` gradients + `skin-shadow` filter (when `skin.surface.richMarkers`) — copy the exact `<defs>` fragment from `drill-board-scene.component.ts` (the `id="skin-glow"`, `id="skin-ball"`, `id="skin-cone"`, `id="skin-shadow"` blocks).
  - After `<defs>`, add the grass `<rect data-grass aria-hidden="true" …>` + the stripe `@for (band of stripeBands(); …)` block (copy from the scene), gated on `@if (skin.surface.grass)`.
  - Pitch markings: replace `stroke="currentColor" stroke-opacity="0.4"` on all three (`rect`/`line`/`path`) cases with `[attr.stroke]="skin.surface.lineColor" [attr.stroke-opacity]="skin.surface.lineOpacity"`.
  - Arrows `<g>`: add `[attr.filter]="skin.surface.glow !== 'none' ? 'url(#skin-glow)' : null"`; on each `<line data-arrow>` replace `arrowColor/arrowWidth/arrowDash` with `skin.arrow[a.kind].stroke / .width / .dash`. Keep `role="button" tabindex="0" [attr.aria-label] (pointerdown)`.
  - Dots: replace the `@if (d.kind === 'cone')` block with a glyph switch on `skin.dot[d.kind].glyph` (jersey / cone / ball / default-circle) copied from the scene — BUT on every branch keep the editor interaction attributes (`data-dot`, `[attr.data-dot-id]="d.id"`, `role="button"`, `tabindex="0"`, `[attr.aria-label]="d.ariaLabel"`, `[attr.aria-grabbed]="grabbed() === d.id"`, `(pointerdown)="onDotPointerDown($event, d.id)"`). The jersey branch wraps `<g [attr.filter]="markerFilter(skin)">` with the `<path data-dot …>` + the number `<text>` when `skin.dot[d.kind].number && d.label`.
  - Optionally add the legend block from the scene (acceptance lists legend parity) below the `<svg>`, `aria-hidden="true"`.

- [ ] **Step 5: Run — expect PASS (new skin tests + all existing editor tests)**

Run: `npx nx test pack-football-ui`
Expected: PASS. If an existing interaction/a11y test fails, it is querying a glyph-specific element (e.g. `circle[data-dot]`) — fix by making the assertion glyph-agnostic (`[data-dot]`) OR confirm the test sets no skin (schematic → still `<circle>`/`<polygon>` as before). Do NOT weaken interaction coverage.

- [ ] **Step 6: Build the lib**

Run: `npx nx build pack-football-ui`
Expected: builds.

- [ ] **Step 7: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts
git commit -m "feat(pack-football-ui): editor renders the active skin at scene-parity (S2.3)"
```

---

### Task 12: Panel seeds + persists the skin

**Files:**
- Modify: `libs/pack-football-ui/src/lib/drills/drill-editor-panel.component.ts`
- Test: `libs/pack-football-ui/src/lib/drills/drill-editor-panel.component.spec.ts` (append)

- [ ] **Step 1: Write the failing tests** — append:

```typescript
it('seeds the skin from the entry and passes it to saveDrillDiagram', async () => {
  const TENANT = {
    key: 'football.intervention.drill.mine.fork.x', name: 'Mine',
    phase: 'warmup', intensity: 'easy', tier: 'tenant', diagram: null, skin: 'arena',
  };
  const f = TestBed.createComponent(DrillEditorPanelComponent);
  f.componentRef.setInput('entry', TENANT);
  f.detectChanges();
  await f.componentInstance.onSave();
  expect(client.saveDrillDiagram).toHaveBeenCalledWith('football.intervention.drill.mine.fork.x', expect.anything(), 'arena');
});

it('defaults to matchday when the entry has no skin', async () => {
  const TENANT = {
    key: 'football.intervention.drill.mine.fork.x', name: 'Mine',
    phase: 'warmup', intensity: 'easy', tier: 'tenant', diagram: null, skin: null,
  };
  const f = TestBed.createComponent(DrillEditorPanelComponent);
  f.componentRef.setInput('entry', TENANT);
  f.detectChanges();
  await f.componentInstance.onSave();
  expect(client.saveDrillDiagram).toHaveBeenCalledWith('football.intervention.drill.mine.fork.x', expect.anything(), 'matchday');
});

it('a skin change marks the panel dirty and is persisted on save', async () => {
  const TENANT = {
    key: 'football.intervention.drill.mine.fork.x', name: 'Mine',
    phase: 'warmup', intensity: 'easy', tier: 'tenant', diagram: null, skin: 'matchday',
  };
  const f = TestBed.createComponent(DrillEditorPanelComponent);
  f.componentRef.setInput('entry', TENANT);
  f.detectChanges();
  f.componentInstance.onSkinChange('telestrator');
  await f.componentInstance.onSave();
  expect(client.saveDrillDiagram).toHaveBeenCalledWith('football.intervention.drill.mine.fork.x', expect.anything(), 'telestrator');
});
```

> Note: the existing panel specs use `VENDOR_ENTRY` objects WITHOUT a `skin` field. Those `saveDrillDiagram` assertions use `expect.anything()` for the 2nd arg and do not constrain a 3rd arg, so they remain green when a 3rd `'matchday'` argument is added. Leave them untouched.

- [ ] **Step 2: Run — expect FAIL** (`onSkinChange` missing; save sends 2 args)

Run: `npx nx test pack-football-ui`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `drill-editor-panel.component.ts`:

Add the import:

```typescript
import type { DrillBoardSkinName } from '../data/wire-schemas.js';
```

Add a `skin` signal and seed it in the existing entry effect:

```typescript
  protected readonly skin = signal<DrillBoardSkinName>('matchday');
```

```typescript
    effect(() => {
      const e = this.entry();
      untracked(() => {
        this.working.set(e.diagram ?? EMPTY_DIAGRAM);
        this.skin.set(e.skin ?? 'matchday');
      });
    });
```

Wire the editor in the template:

```html
    <lib-drill-board-editor
      [diagram]="entry().diagram ?? empty"
      [skin]="skin()"
      (diagramChange)="onDiagramChange($event)"
      (skinChange)="onSkinChange($event)"
    />
```

Add the handler:

```typescript
  onSkinChange(s: DrillBoardSkinName): void {
    this.skin.set(s);
    this.dirty.set(true);
  }
```

Pass skin on save:

```typescript
      await this.client.saveDrillDiagram(targetKey, this.working(), this.skin());
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx nx test pack-football-ui`
Expected: PASS (new + existing panel specs green).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/drills/drill-editor-panel.component.ts libs/pack-football-ui/src/lib/drills/drill-editor-panel.component.spec.ts
git commit -m "feat(pack-football-ui): panel seeds + persists drill skin (S2.3)"
```

---

### Task 13: Library renders the saved skin

**Files:**
- Modify: `libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts` (the `<lib-drill-board-scene … skin="matchday" />` site)
- Test: `libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.spec.ts` (append, if a render assertion is feasible; otherwise rely on the build + the panel/scene coverage)

- [ ] **Step 1: Implement the one-line change.** Replace the hardwired `skin="matchday"` with the entry-driven fallback:

```html
<lib-drill-board-scene [diagram]="entry.diagram" [skin]="entry.skin ?? 'matchday'" />
```

- [ ] **Step 2: Write/append a guard test** (if the spec renders entries) asserting a `telestrator` entry yields grass + telestrator behaviour, OR — if the bibliothek spec does not deep-render scenes — assert the binding via a shallow check. Minimum viable assertion:

```typescript
it('passes the entry skin through to the scene (telestrator → grass)', () => {
  // configure the component with a stubbed client returning one telestrator drill
  // (mirror the existing bibliothek spec's client stub), detectChanges, then:
  // expect a [data-grass] element to exist in the rendered scene.
});
```

If the existing spec architecture makes this costly, document the omission inline (a code comment in the spec) and rely on Task 10 (client carries skin) + Task 8/Task 11 (scene/editor render skin) coverage — do not fake a passing assertion.

- [ ] **Step 3: Run + build**

Run: `npx nx test pack-football-ui && npx nx build pack-football-ui`
Expected: PASS + builds.

- [ ] **Step 4: Commit**

```bash
git add libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.spec.ts
git commit -m "feat(pack-football-ui): Drill Library renders the saved drill skin (S2.3)"
```

---

## Slice S2.4 — Picker UX, a11y, i18n

### Task 14: i18n — skin labels + picker label + announce

**Files:**
- Modify: `libs/pack-football-ui/src/lib/tactical-board/board-i18n.ts` (`BOARD_MESSAGES_DE` + new resolvers)
- Modify: `libs/pack-football-ui/src/lib/i18n/de/board.json`
- Modify: `libs/pack-football-ui/src/lib/i18n/en/board.json`
- Test: `libs/pack-football-ui/src/lib/tactical-board/board-i18n.parity.spec.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `board-i18n.parity.spec.ts`:

```typescript
import { skinLabel, skinChangedLabel } from './board-i18n.js';

it('skinLabel resolves each skin name', () => {
  expect(skinLabel('schematic')).toBe('Schematisch');
  expect(skinLabel('matchday')).toBe('Spieltag');
  expect(skinLabel('telestrator')).toBe('Telestrator');
  expect(skinLabel('arena')).toBe('Arena');
});

it('skinChangedLabel interpolates the skin label', () => {
  expect(skinChangedLabel('arena')).toBe('Darstellung: Arena');
});
```

(The existing parity test `BOARD_MESSAGES_DE` ⟷ `de/board.json` equality will also fail until both carry the new keys — that is expected and guides Step 3.)

- [ ] **Step 2: Run — expect FAIL** (`skinLabel`/`skinChangedLabel` missing; parity mismatch)

Run: `npx nx test pack-football-ui`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add to `BOARD_MESSAGES_DE` in `board-i18n.ts` (place near the other `board.editor.*` keys):

```typescript
  'board.editor.skinPicker.label': 'Darstellung',
  'board.editor.skin.schematic': 'Schematisch',
  'board.editor.skin.matchday': 'Spieltag',
  'board.editor.skin.telestrator': 'Telestrator',
  'board.editor.skin.arena': 'Arena',
  'board.editor.announce.skinChanged': 'Darstellung: {label}',
```

Add resolvers at the bottom of `board-i18n.ts` (the `DrillBoardSkinName` type imports cleanly — it is platform-agnostic):

```typescript
import type { DrillBoardSkinName } from '../generation/drill-board-skins.js';

/** Skin name → its German picker label (`Schematisch`, `Spieltag`, …). */
export function skinLabel(name: DrillBoardSkinName): string {
  return boardMsg(`board.editor.skin.${name}`);
}

/** "Darstellung: {label}" announce string with the skin label interpolated. */
export function skinChangedLabel(name: DrillBoardSkinName): string {
  return boardMsg('board.editor.announce.skinChanged').replace('{label}', skinLabel(name));
}
```

(If a top-of-file import for `DrillArrowKind`/`DrillDotKind` already exists, add `DrillBoardSkinName` to it instead of a second import line.)

Add the SAME six keys to `i18n/de/board.json` (identical German values) and to `i18n/en/board.json` (English values — `'Appearance'`, `'Schematic'`, `'Matchday'`, `'Telestrator'`, `'Arena'`, `'Appearance: {label}'` — non-empty, key-parity only).

- [ ] **Step 4: Run — expect PASS**

Run: `npx nx test pack-football-ui`
Expected: PASS (parity restored; resolvers correct).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/tactical-board/board-i18n.ts libs/pack-football-ui/src/lib/tactical-board/board-i18n.parity.spec.ts libs/pack-football-ui/src/lib/i18n/de/board.json libs/pack-football-ui/src/lib/i18n/en/board.json
git commit -m "feat(pack-football-ui): i18n skin labels + picker label + announce (S2.4)"
```

---

### Task 15: The toolbar skin dropdown (accessible, live re-render + announce)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts` (template toolbar + the `skinLabel`/`skinChangedLabel` imports)
- Test: `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts` (append)

- [ ] **Step 1: Write the failing tests** — append:

```typescript
it('renders an accessible skin dropdown with all four options', () => {
  const f = TestBed.createComponent(DrillBoardEditorComponent);
  f.componentRef.setInput('diagram', ONE_PLAYER);
  f.detectChanges();
  const select = (f.nativeElement as HTMLElement).querySelector('select[data-skin-picker]') as HTMLSelectElement | null;
  expect(select).toBeTruthy();
  expect(select?.getAttribute('aria-label')).toBe('Darstellung');
  expect(select?.querySelectorAll('option')).toHaveLength(4);
});

it('changing the dropdown emits skinChange and announces it', () => {
  const f = TestBed.createComponent(DrillBoardEditorComponent);
  f.componentRef.setInput('diagram', ONE_PLAYER);
  const emitted: string[] = [];
  f.componentInstance.skinChange.subscribe((s: string) => emitted.push(s));
  f.detectChanges();
  f.componentInstance.onSkinChange('telestrator');
  f.detectChanges();
  expect(emitted).toContain('telestrator');
  expect((f.nativeElement as HTMLElement).querySelector('p[aria-live]')?.textContent).toContain('Telestrator');
});
```

- [ ] **Step 2: Run — expect FAIL** (no `select[data-skin-picker]`)

Run: `npx nx test pack-football-ui`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add the `skinLabel`/`skinChangedLabel` to the `board-i18n.js` import in the editor. Add the dropdown to the toolbar `<div role="toolbar">`, after the undo/redo buttons:

```html
        <select
          data-skin-picker
          [attr.aria-label]="msg.skinPicker"
          (change)="onSkinChange($any($event.target).value)"
        >
          @for (s of skinNames; track s) {
            <option [value]="s" [selected]="activeSkin().name === s">{{ skinLabel(s) }}</option>
          }
        </select>
```

Add `skinPicker: boardMsg('board.editor.skinPicker.label')` to the `msg` object.

- [ ] **Step 4: Run — expect PASS**

Run: `npx nx test pack-football-ui`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `npx nx build pack-football-ui`
Expected: builds.

- [ ] **Step 6: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts
git commit -m "feat(pack-football-ui): accessible toolbar skin dropdown (S2.4)"
```

---

## Slice S2.5 — Full-gate verification + PR

### Task 16: Run the full gate, lint, and open the PR

**Files:** none (verification + PR).

- [ ] **Step 1: Build everything affected**

Run: `npx nx run-many -t build -p pack-football-contracts pack-football pack-football-api pack-football-ui`
Expected: all build.

- [ ] **Step 2: Test everything affected**

Run: `npx nx run-many -t test -p pack-football-contracts pack-football pack-football-api pack-football-ui`
Expected: all green. (If `pack-football-ui` OOMs under coverage×pool — a known infra issue — fall back to a single-fork run; see memory `exercir-player-surfaces-arc`.)

- [ ] **Step 3: Lint affected**

Run: `npx nx run-many -t lint -p pack-football-contracts pack-football pack-football-api pack-football-ui`
Expected: clean (no unused imports left from the editor refactor — e.g. removed `drill-board-style` symbols).

- [ ] **Step 4: Push + open the PR** with the twin-ritual lines in the body (per `policies/git.md` + memory `twin-ritual-is-mandatory`):

```bash
git push -u origin feat/board-runtime-s2-skins-editor
gh pr create --title "feat: board runtime S2 — skins into the drill editor (persisted, picker)" --body "$(cat <<'EOF'
Brings the drill editor to skin-parity with the read-only scene, adds an
accessible toolbar skin dropdown, and persists the chosen skin per drill
(metadata.skin passthrough; no DB migration) so the Drill Library renders each
drill in its own skin. Approach B render-reuse = shared pure helpers; the
generic renderer extraction stays in S3.

Spec: docs/superpowers/specs/2026-06-08-board-runtime-s2-skins-editor-design.md
Plan: docs/superpowers/plans/2026-06-08-board-runtime-s2-skins-editor.md

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Effect: cycle-time 0.01±0.02 expert
Effect: findings 1±1 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Run the verifier wave** (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker`, parallel, `isolation: worktree`) per `workflows/verifier-wave.md`; fix any blocking findings; then `drain`/`backfill`/`reconcile` the devloop twin after merge (mandatory ritual).

---

## Self-Review (completed by plan author)

**Spec coverage:** §3 render-reuse Approach 2 → Tasks 7–8, 11. §4.1 contract enum → Task 1, 9. §4.2 metadata.skin (no migration) → Tasks 3–4. §4.3 one save persists both + matchday default → Tasks 6, 10, 12, 13. §4.4 layer threading → Tasks 1–6, 9–13. §5 picker + a11y + per-skin SR-number gate + i18n → Tasks 11 (gate), 14, 15. §6 acceptance (four skins, SR gate, persistence round-trip, Library fallback, existing specs green) → Tasks 11, 12, 13, 16. §7 risks (scene-refactor regression, template density, wire-enum drift, a11y leak) → Tasks 8 (byte-preserve), 7 (helpers), 1/9 (single-source), 11 (gate test).

**Placeholder scan:** no TBD/TODO; every code step shows code. Two intentional "read the file and mirror its style" instructions (Task 5 service-spec wiring, Task 13 bibliothek-spec) are bounded with explicit assertions and a "do not fake a pass" guard.

**Type consistency:** `DrillBoardSkinSchema`/`DrillBoardSkinName` defined once (Task 1), re-exported (Tasks 2, 9), consumed consistently. `updateDrillDiagram(drillKey, diagram, skin?)` arity consistent across out-port (Task 4), repo (Task 4), service (Task 5). `saveDrillDiagram(drillKey, diagram, skin?, signal?)` — skin inserted before the optional `signal` (Task 10); existing 2-arg callers still compile. Editor `skin` input + `skinChange` output + `onSkinChange` used identically in Tasks 11, 12, 15. `skinLabel`/`skinChangedLabel` defined in Task 14, consumed in Tasks 11, 15.
