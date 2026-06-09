# Gridiron S6 — WPA Negative Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Win-Probability-Added (WPA) as a second realized indicator alongside EPA, parameterize the situation-readout + oracle harness by `indicatorKey`, and re-score — demonstrating (predicted) that swapping the realized metric does **not** fix the 2 residual oracle mismatches (the cause is structural, not the metric).

**Architecture:** WPA rides the existing `Play.v1` event + the existing pooled-posterior path — only the catalog indicator, the readout's indicator parameter, and the harness loop are new. Zero kernel change. The pooled `decision`-per-arm subjects are unchanged; only the projected numerator (`payload.wpa` vs `payload.epa`) differs.

**Tech Stack:** TypeScript (ESM, `.js` imports in pack + api), NestJS, Vitest, Zod, `@de-braighter/substrate-{contracts,runtime}` (Normal-Normal); Python (pandas) for the filter ETL.

**Spec:** `docs/superpowers/specs/2026-06-09-gridiron-approach-b-decision-value-design.md` §4.

**Depends on:** slices 1–5 (built). Reuses `GRIDIRON_EPA_PROJECTION` pattern, `armSubjects`, `reduceSituationReadout`, `withOracle`, the harness.

---

## File structure (S6)

| Path | Change | Task |
|---|---|---|
| `tools/filter-pbp.py` | add `wpa` to `COLUMNS` | 1 |
| `libs/gridiron-pack/src/ingestion/play-row.ts` | add `wpa` to `PlayRowSchema` | 2 |
| `libs/gridiron-pack/src/ingestion/play-to-envelope.ts` | add `wpa` to payload | 2 |
| `libs/gridiron-pack/src/inference/indicator.ts` | add `GRIDIRON_WPA_KEY` + `GRIDIRON_WPA_PROJECTION` | 3 |
| `apps/gridiron-api/src/config/gridiron-catalog.ts` | add the wpa indicator entry | 4 |
| `apps/gridiron-api/src/readout/situation-readout.service.ts` | `readout(archetype, indicatorKey?)` | 5 |
| `apps/gridiron-api/src/readout/situation-readout.controller.ts` | optional `indicatorKey` in body | 6 |
| `apps/gridiron-api/src/validation/validate-oracle.main.ts` | loop over `[epa, wpa]`, report each | 7 |
| live | re-ingest + run harness for both | 8 |

Run a single spec: `pnpm -C D:/development/projects/de-braighter/domains/gridiron --filter <pkg> exec vitest run <path>`. Full gate: `pnpm -C D:/development/projects/de-braighter/domains/gridiron run ci:local`.

---

## Task 1: Add `wpa` to the filter ETL

**Files:** Modify `tools/filter-pbp.py`

- [ ] **Step 1: Add the column**

In `tools/filter-pbp.py`, add `"wpa"` to the `COLUMNS` list (nflverse pbp has a `wpa` column). The existing `dropna(subset=["epa","play_type"])` stays as-is (wpa may be null on some plays; the envelope mapper drops null-indicator rows per-indicator at read time, and the pooled readout already tolerates a missing arm). Result:

```python
COLUMNS = [
    "game_id", "play_id", "game_date", "down", "ydstogo", "yardline_100",
    "score_differential", "game_seconds_remaining", "qtr", "play_type", "epa", "wpa",
]
```

- [ ] **Step 2: Commit**

```bash
git -C D:/development/projects/de-braighter/domains/gridiron add tools/filter-pbp.py
git -C D:/development/projects/de-braighter/domains/gridiron commit -m "chore(gridiron): filter-pbp emits wpa column"
```
> End the commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (applies to every commit in this plan).

---

## Task 2: Carry `wpa` in `Play.v1`

**Files:**
- Modify: `libs/gridiron-pack/src/ingestion/play-row.ts`
- Modify: `libs/gridiron-pack/src/ingestion/play-to-envelope.ts`
- Test: `libs/gridiron-pack/src/ingestion/play-to-envelope.spec.ts` (extend)

- [ ] **Step 1: Add the failing assertion** — in `play-to-envelope.spec.ts`, add `wpa` to the `row()` fixture (`wpa: 0.03`) and assert the envelope payload carries it:

```ts
expect(env!.payload).toMatchObject({ epa: 0.42, wpa: 0.03 });
```

- [ ] **Step 2: Run → fail**

Run: `pnpm -C D:/development/projects/de-braighter/domains/gridiron --filter @de-braighter/gridiron-pack exec vitest run src/ingestion/play-to-envelope.spec.ts`
Expected: FAIL (payload has no `wpa`).

- [ ] **Step 3: Implement** — in `play-row.ts` add `wpa: z.number().nullable(),` to `PlayRowSchema`. In `play-to-envelope.ts` add `wpa: row.wpa,` to the payload object (next to `epa`). Leave the null-guard as-is (epa is still the drop condition for the 4th-down stream; wpa-null arms simply contribute no wpa observation).

- [ ] **Step 4: Run → pass.** Then run the full pack suite: `pnpm -C D:/development/projects/de-braighter/domains/gridiron --filter @de-braighter/gridiron-pack test` (all green).

- [ ] **Step 5: Commit**

```bash
git -C D:/development/projects/de-braighter/domains/gridiron add libs/gridiron-pack/src/ingestion/play-row.ts libs/gridiron-pack/src/ingestion/play-to-envelope.ts libs/gridiron-pack/src/ingestion/play-to-envelope.spec.ts
git -C D:/development/projects/de-braighter/domains/gridiron commit -m "feat(gridiron): carry wpa in Play.v1 payload"
```

---

## Task 3: WPA indicator + projection (pack)

**Files:**
- Modify: `libs/gridiron-pack/src/inference/indicator.ts`
- Test: `libs/gridiron-pack/src/inference/indicator.spec.ts` (extend)

- [ ] **Step 1: Add the failing test**

```ts
import { GRIDIRON_WPA_KEY, GRIDIRON_WPA_PROJECTION } from './indicator.js';
it('projects payload.wpa over Play.v1', () => {
  expect(GRIDIRON_WPA_KEY).toBe('gridiron.wpa');
  expect(GRIDIRON_WPA_PROJECTION.indicatorKey).toBe('gridiron.wpa');
  expect(GRIDIRON_WPA_PROJECTION.eventTypes).toEqual(['gridiron:Play.v1']);
});
```

- [ ] **Step 2: Run → fail** (`GRIDIRON_WPA_KEY` undefined).

- [ ] **Step 3: Implement** — in `indicator.ts`, mirror `GRIDIRON_EPA_KEY`/`GRIDIRON_EPA_PROJECTION` exactly, swapping the numerator path:

```ts
export const GRIDIRON_WPA_KEY = 'gridiron.wpa';
export const GRIDIRON_WPA_PROJECTION: ObservationProjection = {
  indicatorKey: GRIDIRON_WPA_KEY,
  source: 'event-log',
  eventTypes: [GRIDIRON_PLAY_EVENT_TYPE],
  numeratorPath: requireJsonPath('wpa'),
  timestampPath: requireJsonPath('observedAt'),
};
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git -C D:/development/projects/de-braighter/domains/gridiron add libs/gridiron-pack/src/inference/indicator.ts libs/gridiron-pack/src/inference/indicator.spec.ts
git -C D:/development/projects/de-braighter/domains/gridiron commit -m "feat(gridiron): wpa indicator + projection"
```

---

## Task 4: Register the WPA indicator in the catalog (api)

**Files:** Modify `apps/gridiron-api/src/config/gridiron-catalog.ts`

- [ ] **Step 1: Add the entry** — append a second normal entry (WPA is small-scale; sane weakly-informative priors):

```ts
import { GRIDIRON_EPA_KEY, GRIDIRON_EPA_PROJECTION, GRIDIRON_WPA_KEY, GRIDIRON_WPA_PROJECTION } from '@de-braighter/gridiron-pack';
// inside new InMemoryInferenceCatalog([ ... ]):
{
  indicatorKey: GRIDIRON_WPA_KEY,
  conjugateHint: 'normal',
  priorMean: 0,
  priorSd: 0.1,        // WPA per play is small (~±0.05); tighter prior than EPA
  observationSd: 0.05,
  observationProjection: GRIDIRON_WPA_PROJECTION,
},
```

- [ ] **Step 2: Build** — `pnpm -C D:/development/projects/de-braighter/domains/gridiron --filter @de-braighter/gridiron-api build` (green).

- [ ] **Step 3: Commit**

```bash
git -C D:/development/projects/de-braighter/domains/gridiron add apps/gridiron-api/src/config/gridiron-catalog.ts
git -C D:/development/projects/de-braighter/domains/gridiron commit -m "feat(gridiron): catalog registers the wpa indicator"
```

---

## Task 5: Parameterize the readout by `indicatorKey` (api)

**Files:**
- Modify: `apps/gridiron-api/src/readout/situation-readout.service.ts`
- Test: `apps/gridiron-api/src/readout/situation-readout.service.spec.ts` (extend)

- [ ] **Step 1: Add the failing test** — assert the indicatorKey is threaded into `posterior()`:

```ts
it('uses the requested indicatorKey (wpa) in posterior()', async () => {
  const posterior = vi.fn().mockResolvedValue({ ok: true, value: { summary: { mean: 0, p10: 0, p50: 0, p90: 0, sd: 0.3 } } });
  const moduleRef = await Test.createTestingModule({
    providers: [SituationReadoutService, { provide: INFERENCE_BACKBONE, useValue: { posterior } }],
  }).compile();
  await moduleRef.get(SituationReadoutService).readout(
    { distance: 'short', field: 'opp-side', score: 'trail', time: 'q4-early' }, 'gridiron.wpa',
  );
  expect(posterior.mock.calls[0][0]).toMatchObject({ indicatorKey: 'gridiron.wpa' });
});
```

- [ ] **Step 2: Run → fail** (still passes `gridiron.epa`).

- [ ] **Step 3: Implement** — change the signature + thread it:

```ts
import { GRIDIRON_EPA_KEY, /* … */ } from '@de-braighter/gridiron-pack';

async readout(archetype: SituationArchetype, indicatorKey: string = GRIDIRON_EPA_KEY): Promise<SituationReadout> {
  const key = situationKey(archetype);
  const posteriors: ArmPosterior[] = await Promise.all(
    armSubjects(key).map(async ({ decision, subjectId }) => {
      const r = await this.backbone.posterior({
        tenantPackId: GRIDIRON_TENANT_PACK_ID,
        treeRoot: GRIDIRON_PLAN_ROOT_ID,
        subject: { kind: 'individual', id: subjectId, role: 'gridiron.situation' },
        indicatorKey,
      });
      if (!r.ok) return { decision, summary: null };
      const s = r.value.summary;
      return { decision, summary: { mean: s.mean, p10: s.p10, p50: s.p50, p90: s.p90, sd: s.sd } };
    }),
  );
  return withOracle(reduceSituationReadout(key, posteriors));
}
```
> Note: `EVIDENCE_MAX_SD` (0.6) was tuned for EPA-scale. WPA-scale sd is ~10× smaller, so WPA arms will read `sufficient` very easily — that's fine and even strengthens the negative control (WPA still won't change the *ranking* logic). Do NOT retune the gate in S6; the point is to hold everything constant except the metric.

- [ ] **Step 4: Run → pass** (this spec + the existing service specs stay green).

- [ ] **Step 5: Commit**

```bash
git -C D:/development/projects/de-braighter/domains/gridiron add apps/gridiron-api/src/readout/situation-readout.service.ts apps/gridiron-api/src/readout/situation-readout.service.spec.ts
git -C D:/development/projects/de-braighter/domains/gridiron commit -m "feat(gridiron): readout parameterized by indicatorKey"
```

---

## Task 6: Accept `indicatorKey` in the controller body (api)

**Files:**
- Modify: `apps/gridiron-api/src/readout/situation-readout.controller.ts`
- Test: `apps/gridiron-api/src/readout/situation-readout.controller.spec.ts` (extend)

- [ ] **Step 1: Add the failing test**

```ts
it('passes an optional indicatorKey through to the service', async () => {
  const readout = vi.fn().mockResolvedValue({ recommendedArm: 'go' });
  const controller = new SituationReadoutController({ readout } as never);
  await controller.situationReadout({ distance: 'short', field: 'opp-side', score: 'trail', time: 'q4-early', indicatorKey: 'gridiron.wpa' });
  expect(readout).toHaveBeenCalledWith(
    { distance: 'short', field: 'opp-side', score: 'trail', time: 'q4-early' }, 'gridiron.wpa',
  );
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — extend `SituationBodySchema` with an optional indicator enum and split it out:

```ts
const SituationBodySchema = z.object({
  distance: z.enum(['short', 'medium', 'long']),
  field: z.enum(['own-deep', 'own-mid', 'midfield', 'opp-side', 'fringe']),
  score: z.enum(['trail-big', 'trail', 'close', 'lead', 'lead-big']),
  time: z.enum(['1st-half', 'q3', 'q4-early', '2-min']),
  indicatorKey: z.enum(['gridiron.epa', 'gridiron.wpa']).optional(),
});

@Post('situation-readout')
situationReadout(@Body() body: unknown): Promise<SituationReadout> {
  const { indicatorKey, ...archetype } = SituationBodySchema.parse(body);
  return this.service.readout(archetype, indicatorKey);
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git -C D:/development/projects/de-braighter/domains/gridiron add apps/gridiron-api/src/readout/situation-readout.controller.ts apps/gridiron-api/src/readout/situation-readout.controller.spec.ts
git -C D:/development/projects/de-braighter/domains/gridiron commit -m "feat(gridiron): situation-readout accepts indicatorKey"
```

---

## Task 7: Harness reports agreement per indicator (api)

**Files:** Modify `apps/gridiron-api/src/validation/validate-oracle.main.ts`

- [ ] **Step 1: Loop over indicators** — wrap the existing readout loop so it runs once per indicator and prints a labelled report for each:

```ts
import { ORACLE_ARCHETYPES, compareToOracle, type SituationReadout } from '@de-braighter/gridiron-pack';
// ...
const INDICATORS = ['gridiron.epa', 'gridiron.wpa'] as const;
for (const indicatorKey of INDICATORS) {
  const readouts: SituationReadout[] = [];
  for (const key of Object.keys(ORACLE_ARCHETYPES)) {
    readouts.push(await service.readout(archetypeFromKey(key), indicatorKey));
  }
  console.log(`\n[indicator=${indicatorKey}]`);
  console.log(formatOracleReport(compareToOracle(readouts)));
}
```
> `archetypeFromKey` already exists in the harness (splits the `|` key). Keep it.

- [ ] **Step 2: Build** — `pnpm -C D:/development/projects/de-braighter/domains/gridiron --filter @de-braighter/gridiron-api build` (green).

- [ ] **Step 3: Commit**

```bash
git -C D:/development/projects/de-braighter/domains/gridiron add apps/gridiron-api/src/validation/validate-oracle.main.ts
git -C D:/development/projects/de-braighter/domains/gridiron commit -m "feat(gridiron): oracle harness reports per-indicator (epa + wpa)"
```

---

## Task 8: Live — re-ingest with wpa + run the control

**Verification task (not TDD).** Run from `D:/development/projects/de-braighter/domains/gridiron`.

- [ ] **Step 1: Re-fetch + re-ingest** (the parquet is already downloaded; just re-filter to pick up wpa, then guarded re-ingest):

```bash
python tools/filter-pbp.py data/pbp_2023.parquet data/fourth-downs-2023.json    # now includes wpa
ROWS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/fourth-downs-2023.json','utf8')).length)")
[ "$ROWS" -gt 100 ] && docker exec gridiron-gridiron-db-1 psql -U postgres -d gridiron -c "TRUNCATE kernel.event_log CASCADE;"
pnpm --filter @de-braighter/gridiron-api build
GRIDIRON_PLAY_SOURCE_FILE=data/fourth-downs-2023.json node --env-file=.env apps/gridiron-api/dist/ingestion/ingest.main.js
```
Expected: ~4222 events re-ingested with `wpa` in the payload.

- [ ] **Step 2: Run the per-indicator harness**

```bash
node --env-file=.env apps/gridiron-api/dist/validation/validate-oracle.main.js
```
Expected: two reports. `[indicator=gridiron.epa]` ≈ 9/11 (82%); `[indicator=gridiron.wpa]` ≈ the **same** ballpark with the **same** 4th-and-short mismatches — confirming the metric swap doesn't fix them.

- [ ] **Step 3: Record the negative control in the README** — add a short "S6 — WPA negative control" line to `domains/gridiron/README.md` with both numbers + the conclusion (metric isn't the lever), then commit.

---

## Self-Review

**Spec coverage (§4):** wpa in payload ✅ (T2); wpa indicator ✅ (T3-4); indicatorKey-parameterized readout ✅ (T5-6); per-indicator harness ✅ (T7); documented negative result ✅ (T8). 

**Placeholder scan:** none — all code shown; the `>` notes are constants-rationale / verification.

**Type consistency:** `GRIDIRON_WPA_KEY='gridiron.wpa'`, `readout(archetype, indicatorKey?)`, body `indicatorKey?: 'gridiron.epa'|'gridiron.wpa'`, harness `INDICATORS` — used identically across T3–T7. EVIDENCE_MAX_SD intentionally unchanged.

**Scope:** Single contained slice; S7 (decision-value) + S8 (UI toggle) are separate plans.
