# Gridiron Slice 2 — Inference Catalog + Situation Readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the ingested `gridiron:Play.v1` events into a per-situation 4th-down recommendation: for a chosen `{distance, field, score, time}` archetype, run Normal-Normal `posterior()` once per arm-subject (go/punt/kick), rank the arms by mean EPA, and return the recommended arm + lift over the status-quo (punt) from `POST /gridiron/situation-readout`.

**Architecture:** Pure pack code defines the EPA indicator + `ObservationProjection` (over `gridiron:Play.v1`, `numeratorPath = payload.epa`, `timestampPath = payload.observedAt`), the arm-subject builder (`archetypeArmId` from slice 1), and a pure reducer that ranks per-arm posterior summaries into a `SituationReadout`. The api wires the scaffolded 5-provider inference chain to a gridiron catalog and a `SituationReadoutService` that fans `posterior()` across arms (the kernel `counterfactual()` primitive does **not** apply — arms are distinct subjects, per spec OPEN-1). Zero kernel change.

**Tech Stack:** TypeScript (ESM, `.js` imports), NestJS, Vitest, Zod, `@de-braighter/substrate-{contracts,runtime}` inference (`INFERENCE_BACKBONE`, `InMemoryInferenceCatalog`, `ObservationProjection`, `requireJsonPath`).

**Spec:** `docs/superpowers/specs/2026-06-09-gridiron-nfl-4th-down-what-if-design.md` §6–§7 (OPEN-1 resolved (a): compose `posterior()`, no `counterfactual()`).

**Depends on:** Slice 1 (events in `event_log` with `payload.epa` + `payload.observedAt`; `GRIDIRON_PLAN_ROOT_ID` seeded; `archetypeArmId`, `situationKey`, `GRIDIRON_PLAY_EVENT_TYPE` exported from `@de-braighter/gridiron-pack`).

**Conventions to mirror (read before coding):**
- `domains/markets/libs/markets-pack/src/inference/inference-catalog.ts` — `ObservationProjection` literal + `requireJsonPath`.
- `domains/markets/apps/markets-api/src/config/markets-catalog.ts` — `buildMarketsCatalog()`.
- `domains/markets/apps/markets-api/src/readout/readout.service.ts` — the `backbone.posterior({...})` call + `Result` unwrap.
- `domains/markets/apps/markets-api/src/app/app.module.ts:73-98` — the 5-provider inference chain (already scaffolded into gridiron-api in slice 1; this slice points its catalog at the EPA indicator).

---

## File structure (slice 2)

| Path | Responsibility | Task |
|---|---|---|
| `libs/gridiron-pack/src/inference/indicator.ts` | EPA indicator key, `ObservationProjection`, arm list, arm-subject builder | 1 |
| `libs/gridiron-pack/src/inference/situation-readout.ts` | pure reducer: per-arm summaries → ranked `SituationReadout` | 2 |
| `libs/gridiron-pack/src/index.ts` (modify) | re-export inference module | 1–2 |
| `apps/gridiron-api/src/config/gridiron-catalog.ts` (modify scaffold) | `buildGridironCatalog()` → EPA entry | 3 |
| `apps/gridiron-api/src/readout/situation-readout.service.ts` | fan `posterior()` across arms, reduce | 4 |
| `apps/gridiron-api/src/readout/situation-readout.controller.ts` | `POST /gridiron/situation-readout` + body schema | 5 |
| `apps/gridiron-api/src/app/app.module.ts` (modify) | register the service + controller; point catalog at EPA | 6 |

> The slice-1 `/new-domain` inference tier already scaffolded `apps/gridiron-api/src/config/gridiron-catalog.ts` (a `buildGridironCatalog()` with a placeholder entry) and an example readout service/controller. This slice **replaces** the placeholder catalog entry and **adds** the situation readout; delete the scaffolded example `readout.service.ts`/`readout.controller.ts` if present (Task 6).

---

## Task 1: EPA indicator + projection + arm subjects (pack)

**Files:**
- Create: `libs/gridiron-pack/src/inference/indicator.ts`
- Test: `libs/gridiron-pack/src/inference/indicator.spec.ts`
- Modify: `libs/gridiron-pack/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/gridiron-pack/src/inference/indicator.spec.ts
import { describe, expect, it } from 'vitest';
import { archetypeArmId } from '../archetype/archetype-id.js';
import { GRIDIRON_ARMS, GRIDIRON_EPA_KEY, GRIDIRON_EPA_PROJECTION, armSubjects } from './indicator.js';

describe('gridiron EPA indicator', () => {
  it('projects payload.epa / payload.observedAt over Play.v1', () => {
    expect(GRIDIRON_EPA_KEY).toBe('gridiron.epa');
    expect(GRIDIRON_EPA_PROJECTION.indicatorKey).toBe('gridiron.epa');
    expect(GRIDIRON_EPA_PROJECTION.source).toBe('event-log');
    expect(GRIDIRON_EPA_PROJECTION.eventTypes).toEqual(['gridiron:Play.v1']);
  });

  it('lists the slice-2 arms', () => {
    expect(GRIDIRON_ARMS).toEqual(['go', 'punt', 'kick']);
  });

  it('builds one arm-subject id per arm for a situation key', () => {
    const subs = armSubjects('short|opp-side|trail|q4-early');
    expect(subs.map((s) => s.decision)).toEqual(['go', 'punt', 'kick']);
    expect(subs[0].subjectId).toBe(archetypeArmId('short|opp-side|trail|q4-early', 'go'));
    // all distinct
    expect(new Set(subs.map((s) => s.subjectId)).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/inference/indicator.spec.ts`
Expected: FAIL — `Cannot find module './indicator.js'`.

- [ ] **Step 3: Add the substrate inference dep (if not already present)**

First open `domains/markets/libs/markets-pack/src/inference/inference-catalog.ts` and note the exact import source for `ObservationProjection` and `requireJsonPath` (expected `@de-braighter/substrate-runtime`). Then ensure gridiron-pack has it:
```bash
pnpm --filter @de-braighter/gridiron-pack add @de-braighter/substrate-runtime
```
> If markets-pack imports those names from `@de-braighter/substrate-contracts`, add/keep that instead and adjust the import in Step 4.

- [ ] **Step 4: Write minimal implementation**

```ts
// libs/gridiron-pack/src/inference/indicator.ts
import { type ObservationProjection, requireJsonPath } from '@de-braighter/substrate-runtime';
import type { Arm } from '../archetype/archetype.js';
import { archetypeArmId } from '../archetype/archetype-id.js';
import { GRIDIRON_PLAY_EVENT_TYPE } from '../ingestion/play-to-envelope.js';

export const GRIDIRON_EPA_KEY = 'gridiron.epa';

/** EPA per play, read from the Play.v1 payload. */
export const GRIDIRON_EPA_PROJECTION: ObservationProjection = {
  indicatorKey: GRIDIRON_EPA_KEY,
  source: 'event-log',
  eventTypes: [GRIDIRON_PLAY_EVENT_TYPE],
  numeratorPath: requireJsonPath('epa'),
  timestampPath: requireJsonPath('observedAt'),
};

/** Arms ranked in slices 2–3 (multi-lever go-run/go-pass deferred per spec §7). */
export const GRIDIRON_ARMS: readonly Arm[] = ['go', 'punt', 'kick'];

export interface ArmSubject {
  decision: Arm;
  subjectId: string;
}

/** One inference subject id per arm for a situation (= archetypeArmId(key, arm)). */
export function armSubjects(situationKey: string): readonly ArmSubject[] {
  return GRIDIRON_ARMS.map((decision) => ({ decision, subjectId: archetypeArmId(situationKey, decision) }));
}
```
> Confirm the exact `ObservationProjection` field names + the `requireJsonPath` helper name against `markets-pack/src/inference/inference-catalog.ts`. If the helper is `asJsonPath`, use that.

- [ ] **Step 5: Re-export from the pack index**

Edit `libs/gridiron-pack/src/index.ts` — add:
```ts
export * from './inference/indicator.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/inference/indicator.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add libs/gridiron-pack/src/inference/indicator.ts libs/gridiron-pack/src/inference/indicator.spec.ts libs/gridiron-pack/src/index.ts libs/gridiron-pack/package.json
git commit -m "feat(gridiron): EPA indicator + projection + arm-subject builder"
```

---

## Task 2: Pure situation-readout reducer (pack)

**Files:**
- Create: `libs/gridiron-pack/src/inference/situation-readout.ts`
- Test: `libs/gridiron-pack/src/inference/situation-readout.spec.ts`
- Modify: `libs/gridiron-pack/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/gridiron-pack/src/inference/situation-readout.spec.ts
import { describe, expect, it } from 'vitest';
import { reduceSituationReadout, type ArmPosterior } from './situation-readout.js';

const summary = (mean: number) => ({ mean, p10: mean - 1, p50: mean, p90: mean + 1, sd: 0.8 });

describe('reduceSituationReadout', () => {
  it('ranks arms by mean EPA (higher is better) and recommends the top', () => {
    const posteriors: ArmPosterior[] = [
      { decision: 'go', summary: summary(0.42) },
      { decision: 'punt', summary: summary(-0.10) },
      { decision: 'kick', summary: summary(0.05) },
    ];
    const out = reduceSituationReadout('short|opp-side|trail|q4-early', posteriors);
    expect(out.arms.map((a) => a.decision)).toEqual(['go', 'kick', 'punt']);
    expect(out.recommendedArm).toBe('go');
    expect(out.statusQuoArm).toBe('punt');
    expect(out.liftMean).toBeCloseTo(0.52, 5); // go.mean - punt.mean
    expect(out.direction).toBe('improves');
  });

  it('reports flat when the recommended arm is punt itself', () => {
    const out = reduceSituationReadout('long|own-deep|close|1st-half', [
      { decision: 'go', summary: summary(-0.5) },
      { decision: 'punt', summary: summary(0.1) },
      { decision: 'kick', summary: summary(-0.3) },
    ]);
    expect(out.recommendedArm).toBe('punt');
    expect(out.liftMean).toBeCloseTo(0, 5);
    expect(out.direction).toBe('flat');
  });

  it('treats lift within the dead band as flat', () => {
    const out = reduceSituationReadout('medium|midfield|close|q3', [
      { decision: 'go', summary: summary(0.02) },
      { decision: 'punt', summary: summary(0.0) },
      { decision: 'kick', summary: summary(-0.4) },
    ]);
    expect(out.recommendedArm).toBe('go');
    expect(out.direction).toBe('flat'); // 0.02 < 0.05 dead band
  });

  it('drops arms whose posterior failed', () => {
    const out = reduceSituationReadout('short|fringe|lead|2-min', [
      { decision: 'go', summary: summary(0.3) },
      { decision: 'punt', summary: null },
      { decision: 'kick', summary: summary(0.6) },
    ]);
    expect(out.arms.map((a) => a.decision)).toEqual(['kick', 'go']);
    expect(out.recommendedArm).toBe('kick');
    // status-quo (punt) unavailable → lift falls back to recommended vs itself = 0
    expect(out.liftMean).toBeCloseTo(0, 5);
  });

  it('throws when no arm has a posterior', () => {
    expect(() =>
      reduceSituationReadout('x', [{ decision: 'go', summary: null }]),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/inference/situation-readout.spec.ts`
Expected: FAIL — `Cannot find module './situation-readout.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// libs/gridiron-pack/src/inference/situation-readout.ts
import type { Arm } from '../archetype/archetype.js';

export interface ArmSummary {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  sd: number;
}

export interface ArmPosterior {
  decision: Arm;
  summary: ArmSummary | null; // null when inference failed for this arm
}

export interface RankedArm extends ArmSummary {
  decision: Arm;
}

export type Direction = 'improves' | 'worsens' | 'flat';

export interface SituationReadout {
  situationKey: string;
  arms: readonly RankedArm[]; // ranked desc by mean (EPA: higher = better)
  recommendedArm: Arm;
  statusQuoArm: Arm;
  liftMean: number; // recommended.mean - statusQuo.mean
  direction: Direction;
}

/** EPA lift (points) below which the recommendation is reported as "flat". */
export const GRIDIRON_FLAT_DEAD_BAND = 0.05;

const STATUS_QUO: Arm = 'punt';

export function reduceSituationReadout(
  situationKey: string,
  posteriors: readonly ArmPosterior[],
): SituationReadout {
  const ranked: RankedArm[] = posteriors
    .filter((p): p is { decision: Arm; summary: ArmSummary } => p.summary !== null)
    .map((p) => ({ decision: p.decision, ...p.summary }))
    .sort((a, b) => b.mean - a.mean);

  if (ranked.length === 0) {
    throw new Error(`no arm posteriors available for situation ${situationKey}`);
  }

  const recommended = ranked[0];
  const statusQuo = ranked.find((a) => a.decision === STATUS_QUO) ?? recommended;
  const liftMean = recommended.mean - statusQuo.mean;
  const direction: Direction =
    Math.abs(liftMean) < GRIDIRON_FLAT_DEAD_BAND ? 'flat' : liftMean > 0 ? 'improves' : 'worsens';

  return {
    situationKey,
    arms: ranked,
    recommendedArm: recommended.decision,
    statusQuoArm: STATUS_QUO,
    liftMean,
    direction,
  };
}
```

- [ ] **Step 4: Re-export from the pack index**

Edit `libs/gridiron-pack/src/index.ts` — add:
```ts
export * from './inference/situation-readout.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/inference/situation-readout.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/gridiron-pack/src/inference/situation-readout.ts libs/gridiron-pack/src/inference/situation-readout.spec.ts libs/gridiron-pack/src/index.ts
git commit -m "feat(gridiron): pure situation-readout reducer (rank arms, lift, direction)"
```

---

## Task 3: Point the catalog at the EPA indicator (api)

**Files:**
- Modify: `apps/gridiron-api/src/config/gridiron-catalog.ts` (scaffolded in slice 1)

- [ ] **Step 1: Replace the placeholder catalog entry**

Open the scaffolded `buildGridironCatalog()` and replace its placeholder entry with the EPA indicator (weakly-informative prior centred on zero EPA):

```ts
// apps/gridiron-api/src/config/gridiron-catalog.ts
import { InMemoryInferenceCatalog } from '@de-braighter/substrate-runtime';
import { GRIDIRON_EPA_KEY, GRIDIRON_EPA_PROJECTION } from '@de-braighter/gridiron-pack';

export function buildGridironCatalog(): InMemoryInferenceCatalog {
  return new InMemoryInferenceCatalog([
    {
      indicatorKey: GRIDIRON_EPA_KEY,
      conjugateHint: 'normal',
      priorMean: 0,        // EPA centres on zero
      priorSd: 2.5,        // covers the typical ±3 EPA range
      observationSd: 1,    // per-play EPA noise; posterior dominated after ~4–5 plays
      observationProjection: GRIDIRON_EPA_PROJECTION,
    },
  ]);
}
```
> Confirm `InMemoryInferenceCatalog` import source + the entry field names against `markets-catalog.ts`.

- [ ] **Step 2: Build the api to type-check the catalog**

Run: `pnpm --filter @de-braighter/gridiron-api build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/gridiron-api/src/config/gridiron-catalog.ts
git commit -m "feat(gridiron): catalog binds the EPA indicator (normal-normal)"
```

---

## Task 4: Situation readout service (api)

**Files:**
- Create: `apps/gridiron-api/src/readout/situation-readout.service.ts`
- Test: `apps/gridiron-api/src/readout/situation-readout.service.spec.ts`

- [ ] **Step 1: Write the failing test** (mock the inference backbone)

```ts
// apps/gridiron-api/src/readout/situation-readout.service.spec.ts
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INFERENCE_BACKBONE } from '@de-braighter/substrate-contracts/inference';
import { armSubjects } from '@de-braighter/gridiron-pack';
import { SituationReadoutService } from './situation-readout.service.js';

const handle = (mean: number) => ({
  ok: true,
  value: { summary: { mean, p10: mean - 1, p50: mean, p90: mean + 1, sd: 0.8 } },
});

describe('SituationReadoutService', () => {
  it('runs one posterior per arm-subject and reduces to a recommendation', async () => {
    const meanByArm: Record<string, number> = { go: 0.42, punt: -0.1, kick: 0.05 };
    const posterior = vi.fn().mockImplementation(async (input: { subject: { id: string } }) => {
      const key = 'short|opp-side|trail|q4-early';
      const arm = armSubjects(key).find((s) => s.subjectId === input.subject.id)!.decision;
      return handle(meanByArm[arm]);
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        SituationReadoutService,
        { provide: INFERENCE_BACKBONE, useValue: { posterior } },
      ],
    }).compile();

    const service = moduleRef.get(SituationReadoutService);
    const out = await service.readout({ distance: 'short', field: 'opp-side', score: 'trail', time: 'q4-early' });

    expect(posterior).toHaveBeenCalledTimes(3);
    // each call: individual subject, gridiron.epa indicator, the seeded plan root
    expect(posterior.mock.calls[0][0]).toMatchObject({
      indicatorKey: 'gridiron.epa',
      subject: { kind: 'individual', role: 'gridiron.situation' },
    });
    expect(out.recommendedArm).toBe('go');
    expect(out.arms.map((a) => a.decision)).toEqual(['go', 'kick', 'punt']);
  });

  it('drops an arm whose posterior returns an error result', async () => {
    const posterior = vi.fn().mockImplementation(async (input: { subject: { id: string } }) => {
      const key = 'long|own-deep|close|1st-half';
      const arm = armSubjects(key).find((s) => s.subjectId === input.subject.id)!.decision;
      if (arm === 'go') return { ok: false, error: { kind: 'inference-failed' } };
      return handle(arm === 'punt' ? 0.2 : -0.1);
    });
    const moduleRef = await Test.createTestingModule({
      providers: [SituationReadoutService, { provide: INFERENCE_BACKBONE, useValue: { posterior } }],
    }).compile();
    const out = await moduleRef.get(SituationReadoutService).readout({
      distance: 'long', field: 'own-deep', score: 'close', time: '1st-half',
    });
    expect(out.arms.map((a) => a.decision)).toEqual(['punt', 'kick']);
    expect(out.recommendedArm).toBe('punt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/readout/situation-readout.service.spec.ts`
Expected: FAIL — `Cannot find module './situation-readout.service.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/gridiron-api/src/readout/situation-readout.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { INFERENCE_BACKBONE, type InferenceBackbone } from '@de-braighter/substrate-contracts/inference';
import {
  GRIDIRON_EPA_KEY,
  armSubjects,
  reduceSituationReadout,
  situationKey,
  type ArmPosterior,
  type SituationArchetype,
  type SituationReadout,
} from '@de-braighter/gridiron-pack';
import { GRIDIRON_PLAN_ROOT_ID, GRIDIRON_TENANT_PACK_ID } from '../config/tenants.js';

@Injectable()
export class SituationReadoutService {
  constructor(@Inject(INFERENCE_BACKBONE) private readonly backbone: InferenceBackbone) {}

  async readout(archetype: SituationArchetype): Promise<SituationReadout> {
    const key = situationKey(archetype);

    const posteriors: ArmPosterior[] = await Promise.all(
      armSubjects(key).map(async ({ decision, subjectId }) => {
        const r = await this.backbone.posterior({
          tenantPackId: GRIDIRON_TENANT_PACK_ID,
          treeRoot: GRIDIRON_PLAN_ROOT_ID,
          subject: { kind: 'individual', id: subjectId, role: 'gridiron.situation' },
          indicatorKey: GRIDIRON_EPA_KEY,
        });
        if (!r.ok) return { decision, summary: null };
        const s = r.value.summary;
        return { decision, summary: { mean: s.mean, p10: s.p10, p50: s.p50, p90: s.p90, sd: s.sd } };
      }),
    );

    return reduceSituationReadout(key, posteriors);
  }
}
```
> Confirm two things against `markets/.../readout.service.ts`: (1) the `Result` discriminant — `r.ok`/`r.value`/`r.error` vs an `isOk(r)` helper; (2) the `posterior()` input key is `treeRoot` (not `treeRootId`). `SituationArchetype` is the slice-1 pack type (`{ distance, field, score, time }`); export it from the pack index if not already exported.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/readout/situation-readout.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gridiron-api/src/readout/situation-readout.service.ts apps/gridiron-api/src/readout/situation-readout.service.spec.ts
git commit -m "feat(gridiron): situation readout service fans posterior() across arms"
```

---

## Task 5: Situation readout controller (api)

**Files:**
- Create: `apps/gridiron-api/src/readout/situation-readout.controller.ts`
- Test: `apps/gridiron-api/src/readout/situation-readout.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/gridiron-api/src/readout/situation-readout.controller.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { SituationReadoutController } from './situation-readout.controller.js';

describe('SituationReadoutController', () => {
  it('delegates a valid body to the service', async () => {
    const readout = vi.fn().mockResolvedValue({ recommendedArm: 'go' });
    const controller = new SituationReadoutController({ readout } as never);
    const body = { distance: 'short', field: 'opp-side', score: 'trail', time: 'q4-early' };
    const out = await controller.situationReadout(body);
    expect(readout).toHaveBeenCalledWith(body);
    expect(out).toEqual({ recommendedArm: 'go' });
  });

  it('rejects an invalid bucket value', async () => {
    const controller = new SituationReadoutController({ readout: vi.fn() } as never);
    await expect(
      controller.situationReadout({ distance: 'tiny', field: 'opp-side', score: 'trail', time: 'q4-early' } as never),
    ).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/readout/situation-readout.controller.spec.ts`
Expected: FAIL — `Cannot find module './situation-readout.controller.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/gridiron-api/src/readout/situation-readout.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import type { SituationReadout } from '@de-braighter/gridiron-pack';
import { SituationReadoutService } from './situation-readout.service.js';

const SituationBodySchema = z.object({
  distance: z.enum(['short', 'medium', 'long']),
  field: z.enum(['own-deep', 'own-mid', 'midfield', 'opp-side', 'fringe']),
  score: z.enum(['trail-big', 'trail', 'close', 'lead', 'lead-big']),
  time: z.enum(['1st-half', 'q3', 'q4-early', '2-min']),
});

@Controller('gridiron')
export class SituationReadoutController {
  constructor(private readonly service: SituationReadoutService) {}

  @Post('situation-readout')
  situationReadout(@Body() body: unknown): Promise<SituationReadout> {
    return this.service.readout(SituationBodySchema.parse(body));
  }
}
```
> If gridiron-api uses a global `ZodValidationPipe` (check markets controllers), prefer that over inline `.parse()`. The enum literals MUST match the slice-1 bucket types exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/readout/situation-readout.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gridiron-api/src/readout/situation-readout.controller.ts apps/gridiron-api/src/readout/situation-readout.controller.spec.ts
git commit -m "feat(gridiron): POST /gridiron/situation-readout endpoint"
```

---

## Task 6: Wire the readout into the app module

**Files:**
- Modify: `apps/gridiron-api/src/app/app.module.ts`
- Delete (if present): `apps/gridiron-api/src/readout/readout.service.ts`, `apps/gridiron-api/src/readout/readout.controller.ts` (the slice-1 scaffold examples)

- [ ] **Step 1: Replace the example readout with the situation readout**

In `app.module.ts`: remove the scaffolded `ReadoutService`/`ReadoutController` from `providers`/`controllers`, and add the new ones. Confirm the inference chain (5 providers) already exists from slice 1 and that `INFERENCE_CATALOG` uses `buildGridironCatalog()`:

```ts
import { SituationReadoutController } from '../readout/situation-readout.controller.js';
import { SituationReadoutService } from '../readout/situation-readout.service.js';
import { buildGridironCatalog } from '../config/gridiron-catalog.js';

// const catalog = buildGridironCatalog();   // ensure INFERENCE_CATALOG useValue: catalog
// @Module({
//   controllers: [HealthController, SituationReadoutController],
//   providers: [ SituationReadoutService, /* …existing 5-provider inference chain… */ ],
// })
```
> Delete the scaffolded `readout.service.ts`/`readout.controller.ts` example files if they exist, and drop their imports.

- [ ] **Step 2: Build the api**

Run: `pnpm --filter @de-braighter/gridiron-api build`
Expected: build succeeds; DI graph resolves.

- [ ] **Step 3: Commit**

```bash
git add apps/gridiron-api/src/app/app.module.ts apps/gridiron-api/src/readout
git commit -m "feat(gridiron): wire situation readout + gridiron catalog into the app module"
```

---

## Task 7: Live verification (situation readout returns a ranked recommendation)

**Verification task (not TDD).** Requires slice 1's DB + an ingest run. Run from `domains/gridiron/`.

- [ ] **Step 1: Ensure data is ingested**

Run:
```bash
docker compose up -d gridiron-db
node tools/db/setup.mjs
psql "$DATABASE_URL_MIGRATE" -f tools/db/seed.sql
pip install nfl_data_py pandas
python tools/fetch-nflverse.py --seasons 2022 2023 2024 --out data/fourth-downs-2022-2024.json
pnpm --filter @de-braighter/gridiron-api build
GRIDIRON_DATA_FILE=data/fourth-downs-2022-2024.json pnpm --filter @de-braighter/gridiron-api ingest
```
Expected: a few thousand `gridiron:Play.v1` rows in `kernel.event_log`.

- [ ] **Step 2: Start the api and call the endpoint**

Run:
```bash
pnpm --filter @de-braighter/gridiron-api start &   # node dist/main.js on port 3400
sleep 3
curl -s -X POST http://localhost:3400/gridiron/situation-readout \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: 10000000-0000-4000-8000-000000000001' \
  -H 'x-pack-id: gridiron' \
  -H 'x-user-id: 00000000-0000-4000-8000-000000000001' \
  -d '{"distance":"short","field":"opp-side","score":"trail","time":"q4-early"}' | jq .
```
Expected: JSON with `arms` (3 entries, each with `mean`/`p10`/`p50`/`p90`/`sd`), a `recommendedArm`, `liftMean`, and `direction`. For an aggressive "short / opponent territory / trailing / late" situation, `recommendedArm` should plausibly be `go` with a positive `liftMean` over `punt` — sanity-check against football intuition (formal oracle check is slice 4).

> Confirm the exact tenant/pack/user header names the gridiron-api context guard expects (check the markets proxy.conf.json / context guard); adjust the `-H` flags to match.

- [ ] **Step 3: Record the run in the README**

Append a "Slice 2 — situation readout" section to `domains/gridiron/README.md` with the curl above + a sample response, then:
```bash
git add domains/gridiron/README.md
git commit -m "docs(gridiron): slice-2 situation-readout run recipe"
```

---

## Self-Review

**Spec coverage (§6–§7):** EPA indicator + projection ✅ (Task 1); arm-subject composition (OPEN-1 (a)) ✅ (Tasks 1, 4); `posterior()`-per-arm, no `counterfactual()` ✅ (Task 4); ranked arms + recommended + lift + dead-banded direction ✅ (Task 2); `POST /gridiron/situation-readout` ✅ (Task 5). UI = slice 3; oracle validation = slice 4.

**Placeholder scan:** No deferred-work steps; all code shown. The `>` notes are verification-against-named-files (import sources, `Result` discriminant, header names) — not placeholders.

**Type consistency:** `Arm`, `situationKey`, `armSubjects(key) → {decision, subjectId}`, `ArmPosterior {decision, summary|null}`, `ArmSummary {mean,p10,p50,p90,sd}`, `SituationReadout {situationKey, arms, recommendedArm, statusQuoArm, liftMean, direction}`, `GRIDIRON_EPA_KEY = 'gridiron.epa'`, subject `{kind:'individual', id, role:'gridiron.situation'}`, `treeRoot: GRIDIRON_PLAN_ROOT_ID` — used identically across Tasks 1–6 and matched in the live curl. `SituationArchetype` reused from slice 1.

**Scope:** Single coherent slice (indicator → reducer → catalog → service → controller → wiring → live proof). UI is slice 3; validation harness is slice 4.
