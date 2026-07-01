# Gridiron S7 — Decision-Value Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `decision-value` readout mode that ranks go/punt/kick by the bot's actual formula — `P(convert)·EP(success) − (1−P(convert))·EP_opp(fail)` etc. — built from a **kernel-derived expected-points curve** (Normal-Normal over next-score) plus **Beta-Binomial** conversion + field-goal probabilities, composed in the pack. Targets the 2 residual oracle mismatches.

**Architecture:** Three new kernel-inferred components, all from raw outcomes: (1) EP(fieldBin) — Normal-Normal over a broad `DriveState.v1` stream's signed `nextScorePoints`; (2) P(convert|distance) — Beta-Binomial over go-play `converted`; (3) P(makeFG|kickDist) — Beta-Binomial over field-goal `fgMade`. A pure `decision-value.ts` composes them per situation. The readout gains `mode: 'pooled' | 'decision-value'`. **Zero kernel change** — only the existing `normal` + `beta` conjugates.

**Tech Stack:** TypeScript (ESM, `.js` imports), NestJS, Vitest, Zod, `@de-braighter/substrate-{contracts,runtime}` (Normal-Normal + Beta-Binomial); Python/pandas for ETL.

**Spec:** `docs/superpowers/specs/2026-06-09-gridiron-approach-b-decision-value-design.md` §3, §6.

**Depends on:** S6 (indicatorKey-parameterized readout; the `mode` plumbing extends S6's signature). Reuses `armSubjects`/`reduceSituationReadout` patterns, the harness.

**Reference to mirror (Beta-Binomial):** the **conservation** domain is the proven Beta-Binomial consumer. Before writing the beta indicators (Tasks 4–5), read its beta catalog entry + observation projection + the payload it emits — `D:/development/projects/de-braighter/domains/conservation/` (grep `conjugateHint: 'beta'`, `priorAlpha`, and the `ObservationProjection` it uses) and the substrate `beta-binomial` adapter (`layers/substrate/libs/substrate-runtime/src/inference/adapters/beta-binomial*.ts`) to confirm **how a beta observation carries numerator + denominator** (the adapter does `α += numerator; β += denominator − numerator`). Match that shape exactly; the EPA pattern (single `numeratorPath`) is NOT sufficient for beta.

---

## File structure (S7)

| Path | Change | Task |
|---|---|---|
| `tools/filter-pbp.py` | add `converted`/`fgMade` to 4th-down JSON; emit a broad `drivestate` JSON with `fieldBin`+`nextScorePoints` | 1 |
| `libs/gridiron-pack/src/ingestion/play-row.ts`, `play-to-envelope.ts` | carry `converted`/`fgMade` | 2 |
| `libs/gridiron-pack/src/ingestion/drive-state.ts` (new) | `DriveStateRowSchema`, `driveStateToEnvelope`, `GRIDIRON_DRIVE_STATE_EVENT_TYPE` | 3 |
| `apps/gridiron-api/src/ingestion/*` | a second ingestion entry for the drivestate stream | 3 |
| `libs/gridiron-pack/src/inference/ep-curve.ts` (new) | `fieldBin`, EP indicator + projection, `epBinSubjects` | 4 |
| `libs/gridiron-pack/src/inference/conversion.ts` (new) | convert + FG beta indicators + projections + distance/kickDist subjects | 5 |
| `libs/gridiron-pack/src/inference/decision-value.ts` (new) | pure `composeDecisionValues(...)` | 6 |
| `apps/gridiron-api/src/config/gridiron-catalog.ts` | register EP (normal) + convert/FG (beta) indicators | 4,5 |
| `apps/gridiron-api/src/readout/situation-readout.service.ts` | `mode: 'pooled'|'decision-value'` | 7 |
| `apps/gridiron-api/src/readout/situation-readout.controller.ts` | optional `mode` in body | 7 |
| `apps/gridiron-api/src/validation/validate-oracle.main.ts` | report pooled-epa / pooled-wpa / decision-value | 8 |
| live | broad ingest + run harness | 9 |

pnpm: `pnpm -C D:/development/projects/de-braighter/domains/gridiron --filter <pkg> ...`. Every commit body ends `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do not leave the shell cwd changed.

---

## Task 1: ETL — conversion/FG flags + the next-score broad stream

**Files:** Modify `tools/filter-pbp.py`

- [ ] **Step 1: Add conversion/FG flags to the 4th-down output** — extend `COLUMNS` with `"fourth_down_converted"`, `"field_goal_result"`; in the 4th-down frame derive:
  - `converted` = `fourth_down_converted` (1.0/0.0; null for punt/kick — leave as-is)
  - `fgMade` = `1.0 if field_goal_result == 'made' else 0.0` for `play_type=='field_goal'`, else null
  Add these two derived columns to the records the 4th-down JSON emits (keep existing keys).

- [ ] **Step 2: Add the broad next-score stream** — a new function `emit_drivestate(df_all, out)` that runs over **all** plays (not just 4th downs) and writes `data/drivestate-<season>.json` with one record per play that has a valid field position:

```python
def next_score_points(df):
    """Signed points the POSSESSING team next scores, within the same game-half (0 if none).
    Uses running totals: a score is a play where total_home_score or total_away_score increases."""
    df = df.sort_values(["game_id", "game_half", "play_id"]).copy()
    out = []
    for (_g, _h), grp in df.groupby(["game_id", "game_half"], sort=False):
        rows = grp.to_dict("records")
        # precompute (idx -> (points, scoring_side)) for plays that scored
        home = [r["total_home_score"] for r in rows]
        away = [r["total_away_score"] for r in rows]
        scores = []  # (i, points, side)  side in {"home","away"}
        for i in range(len(rows)):
            ph = home[i] - (home[i-1] if i > 0 else home[0] if i == 0 else 0)
            pa = away[i] - (away[i-1] if i > 0 else away[0] if i == 0 else 0)
            # use prior-play totals as baseline (first play baseline = its own start)
        # simpler: walk deltas vs previous play
        prev_h = rows[0]["total_home_score"]; prev_a = rows[0]["total_away_score"]
        deltas = []
        for i, r in enumerate(rows):
            dh = r["total_home_score"] - prev_h; da = r["total_away_score"] - prev_a
            if dh > 0: deltas.append((i, dh, "home"))
            elif da > 0: deltas.append((i, da, "away"))
            prev_h = r["total_home_score"]; prev_a = r["total_away_score"]
        # for each play, find the first later score in this half
        for i, r in enumerate(rows):
            nxt = next(((pts, side) for (j, pts, side) in deltas if j > i), None)
            if nxt is None:
                nsp = 0.0
            else:
                pts, side = nxt
                scoring_team = r["home_team"] if side == "home" else r["away_team"]
                nsp = float(pts) if scoring_team == r["posteam"] else -float(pts)
            out.append({
                "game_id": r["game_id"], "play_id": int(r["play_id"]),
                "game_date": str(r["game_date"]),
                "yardline_100": r["yardline_100"], "nextScorePoints": nsp,
            })
    return out
```

Filter `df_all` to plays with non-null `yardline_100` and `posteam` before calling. Write the result to `data/drivestate-<season>.json` (a second CLI arg or a `--drivestate` flag).

- [ ] **Step 2b: Validate the ETL** — sanity-check the derived next-score against nflverse's own `ep` column: bin `yardline_100` into 10s, compare `mean(nextScorePoints)` per bin to `mean(ep)` per bin; they should track within ~0.5 pts (cross-check only; nflverse `ep` is NOT ingested). Print the comparison; eyeball it.

- [ ] **Step 3: Commit**

```bash
git -C D:/development/projects/de-braighter/domains/gridiron add tools/filter-pbp.py
git -C D:/development/projects/de-braighter/domains/gridiron commit -m "feat(gridiron): ETL emits convert/fg flags + a next-score drivestate stream"
```

---

## Task 2: Carry `converted`/`fgMade` in `Play.v1`

**Files:** Modify `play-row.ts`, `play-to-envelope.ts`; Test `play-to-envelope.spec.ts`

- [ ] **Step 1: Failing test** — fixture row gains `fourth_down_converted: 1`; assert `env!.payload` has `converted: 1`. Add a `field_goal` row → assert `fgMade` present.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — `PlayRowSchema` add `fourth_down_converted: z.number().nullable()`, `field_goal_result: z.string().nullable()`. In the payload: `converted: row.fourth_down_converted, fgMade: row.field_goal_result === 'made' ? 1 : row.play_type === 'field_goal' ? 0 : null`. (Beta indicators read these only for the relevant arm.)
- [ ] **Step 4: Run → pass** (+ full pack suite).
- [ ] **Step 5: Commit** — `feat(gridiron): carry converted/fgMade in Play.v1`.

---

## Task 3: DriveState stream (pack + api ingestion)

**Files:**
- Create: `libs/gridiron-pack/src/ingestion/drive-state.ts` (+ spec)
- Modify: `apps/gridiron-api/src/ingestion/*` (a drivestate ingestion path), `app/app.module.ts`

- [ ] **Step 1: Failing test** for `driveStateToEnvelope`:

```ts
import { driveStateToEnvelope, GRIDIRON_DRIVE_STATE_EVENT_TYPE, DriveStateRowSchema } from './drive-state.js';
it('maps a play to a DriveState.v1 envelope keyed by field bin', () => {
  const env = driveStateToEnvelope('tpid', { game_id:'g', play_id:7, game_date:'2023-09-11', yardline_100: 35, nextScorePoints: 3 });
  expect(env.eventType).toBe('gridiron:DriveState.v1');
  expect(env.payload).toMatchObject({ fieldBin: 'f30', nextScorePoints: 3, yardline100: 35 });
});
```
(`fieldBin` = 10-yard bin label, e.g. `f30` for yardline_100 in [30,40).)

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `drive-state.ts`:

```ts
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { z } from 'zod';
import { PACK_ID } from '../constants.js';
import { fieldBin } from '../inference/ep-curve.js';        // Task 4 provides fieldBin + fieldBinId
import { fieldBinId } from '../inference/ep-curve.js';

export const GRIDIRON_DRIVE_STATE_EVENT_TYPE = 'gridiron:DriveState.v1';
export const DriveStateRowSchema = z.object({
  game_id: z.string(), play_id: z.number(), game_date: z.string(),
  yardline_100: z.number(), nextScorePoints: z.number(),
});
export type DriveStateRow = z.infer<typeof DriveStateRowSchema>;

export function driveStateToEnvelope(tenantPackId: string, row: DriveStateRow): DomainEventEnvelope {
  const bin = fieldBin(row.yardline_100);
  return {
    packId: PACK_ID, tenantPackId,
    eventType: GRIDIRON_DRIVE_STATE_EVENT_TYPE,
    aggregateType: 'gridiron.drive-state',
    aggregateId: fieldBinId(bin),                 // subject = the field bin
    eventVersion: 1,
    occurredAt: `${row.game_date}T00:00:00.000Z`,
    payload: { fieldBin: bin, yardline100: row.yardline_100, nextScorePoints: row.nextScorePoints, observedAt: `${row.game_date}T00:00:00.000Z` },
    metadata: { actorRef: 'nflverse-file-source' },
  };
}
```
> `fieldBin`/`fieldBinId` come from Task 4 — implement Task 4's `ep-curve.ts` bin helpers first, or stub them here and fill in Task 4 (the suite must be green at each task boundary; do Task 4's bin helpers before this task's test, or co-implement).

- [ ] **Step 4: api ingestion path** — generalize `FilePlaySource`/`PlayIngestionService` OR add a parallel `DriveStateIngestionService` that reads `data/drivestate-*.json`, maps via `driveStateToEnvelope`, and writes through the same outbox **in chunks** (the broad stream is ~50k rows; batch `publishAll` in slices of ~2000 to keep transactions sane). Add an `ingest:drivestate` entrypoint (`apps/gridiron-api/src/ingestion/ingest-drivestate.main.ts`, mirroring `ingest.main.ts`) + npm script. Wire `DriveStateIngestionService` + a `DRIVE_STATE_SOURCE` provider in `app.module.ts` (mirror the `PlayIngestionService`/`PLAY_SOURCE` wiring).
- [ ] **Step 5: Tests** for the chunked service (mock publisher: 5000 rows → publishAll called 3×). **Run → pass.**
- [ ] **Step 6: Commit** — `feat(gridiron): DriveState.v1 broad stream + chunked ingestion`.

---

## Task 4: EP curve — field bins + Normal-Normal indicator (pack + catalog)

**Files:** Create `libs/gridiron-pack/src/inference/ep-curve.ts` (+ spec); Modify `gridiron-catalog.ts`, pack `index.ts`

- [ ] **Step 1: Failing test** — `fieldBin(35)==='f30'`, `fieldBin(5)==='f0'`, `fieldBin(99)==='f90'`; `epBinSubjects()` returns 10 bins f0..f90 each with a `fieldBinId` UUID; `GRIDIRON_EP_KEY==='gridiron.ep'`, projection over `DriveState.v1` numerator `nextScorePoints`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `ep-curve.ts`:

```ts
import { type ObservationProjection } from '@de-braighter/substrate-runtime';
import { v5 as uuidv5 } from 'uuid';
import { GRIDIRON_ARCHETYPE_NAMESPACE } from '../archetype/archetype-id.js';
import { GRIDIRON_DRIVE_STATE_EVENT_TYPE } from '../ingestion/drive-state.js';
import { requireJsonPath } from './indicator.js';   // export requireJsonPath from indicator.ts if not already

export type FieldBin = `f${number}`;
export function fieldBin(yardline100: number): FieldBin {
  const lo = Math.max(0, Math.min(90, Math.floor(yardline100 / 10) * 10));
  return `f${lo}` as FieldBin;
}
export function fieldBinId(bin: FieldBin): string { return uuidv5(`fieldbin|${bin}`, GRIDIRON_ARCHETYPE_NAMESPACE); }
export const GRIDIRON_FIELD_BINS: readonly FieldBin[] = ['f0','f10','f20','f30','f40','f50','f60','f70','f80','f90'];
export function epBinSubjects() { return GRIDIRON_FIELD_BINS.map((bin) => ({ bin, subjectId: fieldBinId(bin) })); }

export const GRIDIRON_EP_KEY = 'gridiron.ep';
export const GRIDIRON_EP_PROJECTION: ObservationProjection = {
  indicatorKey: GRIDIRON_EP_KEY, source: 'event-log',
  eventTypes: [GRIDIRON_DRIVE_STATE_EVENT_TYPE],
  numeratorPath: requireJsonPath('nextScorePoints'),
  timestampPath: requireJsonPath('observedAt'),
};
```
> Export `requireJsonPath` from `indicator.ts` (it currently may be file-private) so `ep-curve.ts` reuses it. Catalog entry (normal): `{ indicatorKey: GRIDIRON_EP_KEY, conjugateHint: 'normal', priorMean: 2, priorSd: 3, observationSd: 4, observationProjection: GRIDIRON_EP_PROJECTION }` (EP ranges ~−3..+7; per-play next-score is noisy → wide observationSd; many obs/bin → posterior tight).

- [ ] **Step 4: Run → pass.** Re-export from pack `index.ts`. Build the api.
- [ ] **Step 5: Commit** — `feat(gridiron): EP-curve field bins + normal indicator`.

---

## Task 5: Conversion + FG probabilities — Beta-Binomial (pack + catalog)

**Files:** Create `libs/gridiron-pack/src/inference/conversion.ts` (+ spec); Modify `gridiron-catalog.ts`, `index.ts`

> **FIRST** read the conservation beta usage + the substrate beta adapter (see "Reference to mirror" above) to confirm the **beta `ObservationProjection` shape** (it carries a numerator AND a denominator — likely `numeratorPath` + `denominatorPath`, or a `value_json` path producing `{numerator,denominator}`). Match it. The code below assumes `numeratorPath`/`denominatorPath`; **adjust to the real field names you find.**

- [ ] **Step 1: Failing test** — `GRIDIRON_CONVERT_KEY==='gridiron.convert'`; `distanceConvertSubjects()` returns short/medium/long subjects; `GRIDIRON_FG_KEY==='gridiron.fg-make'`; `kickDistBucket(/* yardline100 */ 25)` → a bucket label; projections over `Play.v1` reading `converted`/`fgMade`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `conversion.ts` — subjects keyed by distance bucket (reuse `distanceBucket` from archetype) for convert, and by kick-distance bucket for FG; beta projections reading the per-play binary (numerator = the flag, denominator = 1). Mirror the EP-curve subject pattern + the conservation beta projection shape. Catalog entries: `{ indicatorKey: GRIDIRON_CONVERT_KEY, conjugateHint: 'beta', priorAlpha: 2, priorBeta: 2, observationProjection: <beta projection> }` and likewise for FG.
> **Critical:** the convert subject reads only **go-arm** events (the go arm-subject already isolates go plays — so the convert subject id should equal the go arm-subject for that distance? NO — convert is pooled by DISTANCE, not by full archetype. Resolve in implementation: either (a) the convert observation projection filters `Play.v1` to go plays by distance via a distinct aggregateId = `convertDistId(distance)` written ALSO on the go envelope, or (b) add a `convertDistId` aggregate to go plays at ingest. Simplest: at ingest, ALSO emit a lightweight `gridiron:Conversion.v1` event per go play keyed by `convertDistId(distanceBucket)` carrying `converted`. Decide in implementation and keep it consistent; the beta subject.id must equal that aggregateId.)

- [ ] **Step 4: Run → pass.** **Commit** — `feat(gridiron): conversion + FG Beta-Binomial indicators`.

> This task carries the most modeling subtlety (beta projection shape + the conversion subject keying). If the beta `ObservationProjection` shape or the subject-keying can't be cleanly resolved against the substrate/conservation reference, STOP and surface it — do not guess the substrate beta contract.

---

## Task 6: Decision-value composition (pure pack)

**Files:** Create `libs/gridiron-pack/src/inference/decision-value.ts` (+ spec); `index.ts`

- [ ] **Step 1: Failing test** — given an EP lookup, P(convert), P(makeFG), and a situation (spot/togo/kickDist), assert the composed `value(go/punt/kick)` and that the short-yardage opp-territory case ranks **go** top, and a long-yardage own-deep case ranks **punt** top.

```ts
import { composeDecisionValues, NET_PUNT_YDS } from './decision-value.js';
const ep = (yardline100: number) => /* simple monotone stub */ Math.max(-2, 6 - yardline100 * 0.07);
it('ranks go top on 4th-and-short in opponent territory', () => {
  const v = composeDecisionValues({ epAtYardline: ep, spot: 35, togo: 1, pConvert: 0.72, pMakeFg: 0.55, kickDistYardline: 35 });
  expect(v.recommended).toBe('go');
});
it('ranks punt top on 4th-and-long backed up', () => {
  const v = composeDecisionValues({ epAtYardline: ep, spot: 92, togo: 9, pConvert: 0.20, pMakeFg: 0.02, kickDistYardline: 92 });
  expect(v.recommended).toBe('punt');
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the bot's EP-space formulas:

```ts
export const NET_PUNT_YDS = 40;
export type Arm = 'go' | 'punt' | 'kick';
export interface DecisionInput {
  epAtYardline: (yardline100: number) => number;   // EP for posteam, 1st-&-10 at yardline100
  spot: number;   // current yardline_100 (yards to opp end zone)
  togo: number;
  pConvert: number;
  pMakeFg: number;
  kickDistYardline: number;
}
export interface DecisionValues { go: number; punt: number; kick: number; recommended: Arm; }

const epOpp = (ep: DecisionInput['epAtYardline'], spotForOpp: number) => -ep(100 - spotForOpp);

export function composeDecisionValues(d: DecisionInput): DecisionValues {
  const successYardline = Math.max(0, d.spot - d.togo);            // first down ≈ gained `togo`
  const go = d.pConvert * d.epAtYardline(successYardline) + (1 - d.pConvert) * epOpp(d.epAtYardline, d.spot);
  const puntSpotForOpp = Math.min(100, d.spot + NET_PUNT_YDS);     // opponent gets ball ~40 yds downfield (cap)
  const punt = epOpp(d.epAtYardline, puntSpotForOpp);
  const kick = d.pMakeFg * 3 + (1 - d.pMakeFg) * epOpp(d.epAtYardline, d.spot);
  const ranked = ([['go', go], ['punt', punt], ['kick', kick]] as [Arm, number][]).sort((a, b) => b[1] - a[1]);
  return { go, punt, kick, recommended: ranked[0][0] };
}
```
> Sign convention: `epAtYardline(y)` is EP *for the team with the ball* at yardline_100 `y` (lower y = closer to scoring). `epOpp(ep, s)` = the opponent now has the ball, entered as a loss to us = `−ep(100 − s)`. Validate the two test cases pin the signs correctly.

- [ ] **Step 4: Run → pass.** **Commit** — `feat(gridiron): pure decision-value composition (EP-space bot formula)`.

---

## Task 7: `decision-value` readout mode (api)

**Files:** Modify `situation-readout.service.ts`, `situation-readout.controller.ts` (+ specs)

- [ ] **Step 1: Failing service test** — `readout(archetype, { mode: 'decision-value' })` fans the component posteriors (EP bins for `spot` and `successYardline` + `puntSpot`; P(convert) for distance; P(makeFG) for kickDist), composes via `composeDecisionValues`, and returns a `SituationReadout` whose `recommendedArm` matches the composition. Mock `backbone.posterior` to return bin/beta means by subject id.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — change the signature to `readout(archetype, opts?: { mode?: 'pooled' | 'decision-value'; indicatorKey?: string })`. `pooled` = the S6 path (default). `decision-value`:
  - Build an `epAtYardline(y)` from the EP-bin posteriors: fetch `posterior()` for the bins covering `y` (use the bin mean; linear-interpolate between adjacent bin means for smoothness — or nearest-bin for v1).
  - Fetch P(convert) for `distanceBucket(togo)` and P(makeFG) for `kickDistBucket`.
  - `composeDecisionValues({...})` → map to `SituationReadout` arms (each arm's `mean` = its decision value; `sd`/p-quantiles from the component posteriors' spread, or a coarse fixed band for v1) + `recommendedArm`/lift/direction. Apply the evidence gate as: **abstain if the EP bins or P(convert)/P(makeFG) for the chosen arm are prior-dominated** (component posterior sd above its prior-derived ceiling). Reuse `withOracle`.
  - The `spot`/`togo` come from the archetype: derive a representative `spot` (mid-point of the field bucket) + `togo` (mid of the distance bucket) — the archetype is coarse, so document the representative-point choice.
- [ ] **Step 4: Controller** — add `mode: z.enum(['pooled','decision-value']).optional()` to `SituationBodySchema`; pass `{ mode, indicatorKey }` to `readout`. Test.
- [ ] **Step 5: Run → pass** (+ full ci:local). **Commit** — `feat(gridiron): decision-value readout mode`.

> The archetype→representative-(spot,togo) mapping is the main modeling approximation here (the archetype buckets are coarse). Pick bucket mid-points, document them, and note that finer situation input (raw spot/togo on the request) is a clean later refinement.

---

## Task 8: Harness reports all three bases (api)

**Files:** Modify `validate-oracle.main.ts`

- [ ] **Step 1: Extend the loop** to report three lines: `pooled/gridiron.epa`, `pooled/gridiron.wpa`, `decision-value`. For decision-value, call `readout(archetypeFromKey(key), { mode: 'decision-value' })`; for pooled, `{ mode: 'pooled', indicatorKey }`.
- [ ] **Step 2: Build.** **Commit** — `feat(gridiron): harness reports pooled-epa/wpa + decision-value agreement`.

---

## Task 9: Live — broad ingest + decision-value harness

**Verification task.** From `D:/development/projects/de-braighter/domains/gridiron`.

- [ ] **Step 1: Re-fetch + ingest both streams**

```bash
python tools/filter-pbp.py data/pbp_2023.parquet data/fourth-downs-2023.json --drivestate data/drivestate-2023.json
# guarded truncate, then both ingests:
docker exec gridiron-gridiron-db-1 psql -U postgres -d gridiron -c "TRUNCATE kernel.event_log CASCADE;"
pnpm --filter @de-braighter/gridiron-api build
GRIDIRON_PLAY_SOURCE_FILE=data/fourth-downs-2023.json node --env-file=.env apps/gridiron-api/dist/ingestion/ingest.main.js
GRIDIRON_DRIVE_STATE_FILE=data/drivestate-2023.json node --env-file=.env apps/gridiron-api/dist/ingestion/ingest-drivestate.main.js
```
Expected: ~4222 `Play.v1` + ~tens-of-thousands `DriveState.v1` events.

- [ ] **Step 2: Run the three-way harness**

```bash
node --env-file=.env apps/gridiron-api/dist/validation/validate-oracle.main.js
```
Expected: `pooled/epa` ≈ 82%, `pooled/wpa` ≈ 82% (S6 negative), **`decision-value` > 82%** with the 2 short-yardage mismatches flipped toward `go`. Record all three numbers + the verdict in `domains/gridiron/README.md`; commit.

---

## Self-Review

**Spec coverage (§3,§6):** EP curve via Normal-Normal over broad next-score ✅ (T1,T3,T4); P(convert)/P(makeFG) Beta-Binomial ✅ (T5); net-punt constant ✅ (T6); decision-value composition ✅ (T6); decision-value readout mode ✅ (T7); per-basis harness ✅ (T8); live verification ✅ (T9). Honest limitation (league-pooled, no game-state) carried from the spec — not implemented (it's #3), correctly out of scope.

**Placeholder scan:** the two genuine unknowns are flagged as STOP-and-verify against named reference code (the beta `ObservationProjection` shape in T5; the conversion subject-keying in T5) — these are verification gates, not silent placeholders. The `nextScorePoints` ETL + decision-value math are shown in full.

**Type consistency:** `Arm`, `fieldBin`/`fieldBinId`/`FieldBin`, `GRIDIRON_EP_KEY/CONVERT_KEY/FG_KEY`, `composeDecisionValues(DecisionInput)→DecisionValues`, `readout(archetype, opts?)` — consistent across tasks. `requireJsonPath` exported from `indicator.ts` for reuse (T4).

**Scope:** S7 is large but one coherent slice (data → 3 inference components → composition → mode → harness). If the executor finds it too big, T1–T5 (data + components) and T6–T9 (compose + surface) are a natural mid-point split. UI toggle = S8.
