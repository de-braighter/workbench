# Gridiron Slice 4 — Oracle Validation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the kernel's 4th-down recommendations against the public "4th-down bot" consensus: a curated oracle fixture of high-consensus archetypes, a pure agreement comparator, a standalone harness that runs the situation-readout over the fixture and reports the agreement rate, and the UI "vs. the bot" badge (deferred from slice 3).

**Architecture:** A pack-level oracle fixture maps `situationKey → recommended arm` for archetypes where the analytics consensus is clear. A pure comparator computes agreement + mismatches. The situation-readout is enriched (pure `withOracle()`) with `oracleArm` + `agreesWithOracle`, surfaced through the api and rendered as a non-color-alone badge in the web UI. A standalone harness script runs the real readout across the fixture against the ingested DB and prints the agreement rate. **Honest framing (spec §9):** slice 1 ingests EPA, so this is a *consistency check* — it proves the kernel correctly pools a known quantity and reproduces the consensus recommendation; it becomes independent validation only when the indicator flips to `rawOutcome` (Approach B).

**Tech Stack:** TypeScript (ESM, `.js` imports), NestJS standalone context, Angular, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-gridiron-nfl-4th-down-what-if-design.md` §9 (validation harness) + §8 (oracle badge).

**Depends on:** Slice 2 (`SituationReadout` + `SituationReadoutService`) and slice 3 (`ArmsDisplayComponent`, `SituationReadoutWire`).

---

## File structure (slice 4)

| Path | Responsibility | Task |
|---|---|---|
| `libs/gridiron-pack/src/oracle/fourth-down-oracle.ts` | curated `situationKey → arm` fixture + lookup | 1 |
| `libs/gridiron-pack/src/oracle/oracle-comparison.ts` | pure agreement comparator + `withOracle()` enrichment | 2 |
| `libs/gridiron-pack/src/inference/situation-readout.ts` (modify) | add optional `oracleArm` / `agreesWithOracle` fields | 2 |
| `libs/gridiron-pack/src/index.ts` (modify) | re-export oracle module | 1–2 |
| `apps/gridiron-api/src/readout/situation-readout.service.ts` (modify) | enrich the readout with oracle agreement | 3 |
| `apps/gridiron-api/src/validation/validate-oracle.main.ts` | standalone harness: readout over fixture → agreement report | 4 |
| `apps/gridiron-api/src/validation/oracle-report.ts` + spec | pure report formatter | 4 |
| `apps/gridiron-web/src/app/data/situation-readout.wire.ts` (modify) | allow `oracleArm`/`agreesWithOracle` | 5 |
| `apps/gridiron-web/src/app/what-if/arms-display.component.ts` (modify) | "vs. the bot" badge | 5 |

---

## Task 1: Oracle fixture + lookup (pack)

**Files:**
- Create: `libs/gridiron-pack/src/oracle/fourth-down-oracle.ts`
- Test: `libs/gridiron-pack/src/oracle/fourth-down-oracle.spec.ts`
- Modify: `libs/gridiron-pack/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/gridiron-pack/src/oracle/fourth-down-oracle.spec.ts
import { describe, expect, it } from 'vitest';
import { ORACLE_ARCHETYPES, oracleRecommendation } from './fourth-down-oracle.js';

describe('fourth-down oracle fixture', () => {
  it('returns the consensus arm for a known archetype', () => {
    expect(oracleRecommendation('short|opp-side|trail|q4-early')).toBe('go');
    expect(oracleRecommendation('long|own-deep|close|1st-half')).toBe('punt');
    expect(oracleRecommendation('medium|fringe|close|q4-early')).toBe('kick');
  });
  it('returns null for an archetype not in the fixture', () => {
    expect(oracleRecommendation('medium|midfield|lead|q3')).toBeNull();
  });
  it('every fixture key is a well-formed situation key with a valid arm', () => {
    for (const [key, arm] of Object.entries(ORACLE_ARCHETYPES)) {
      expect(key.split('|')).toHaveLength(4);
      expect(['go', 'punt', 'kick']).toContain(arm);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/oracle/fourth-down-oracle.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// libs/gridiron-pack/src/oracle/fourth-down-oracle.ts
import type { Arm } from '../archetype/archetype.js';

/**
 * High-consensus 4th-down recommendations from the public win-probability / 4th-down
 * models (e.g. Baldwin's nfl4th, the broadcast "4th-down bots"). Curated anchors only —
 * archetypes where the analytics consensus is unambiguous. Extend from a published model.
 */
export const ORACLE_ARCHETYPES: Readonly<Record<string, Arm>> = {
  // short yardage → go almost everywhere outside your own deep territory
  'short|opp-side|trail|q4-early': 'go',
  'short|opp-side|close|q3': 'go',
  'short|fringe|trail|2-min': 'go',
  'short|midfield|close|q3': 'go',
  // long yardage, backed up → punt
  'long|own-deep|close|1st-half': 'punt',
  'long|own-deep|lead|q4-early': 'punt',
  'long|own-mid|close|q3': 'punt',
  'medium|own-mid|lead|q4-early': 'punt',
  // field-goal range, not desperate → kick
  'medium|fringe|close|q4-early': 'kick',
  'medium|fringe|lead|2-min': 'kick',
  'long|fringe|lead|q4-early': 'kick',
  // trailing big and late → go (desperation)
  'long|opp-side|trail-big|2-min': 'go',
};

/** The consensus arm for a situation, or null if the situation is not a curated anchor. */
export function oracleRecommendation(situationKey: string): Arm | null {
  return ORACLE_ARCHETYPES[situationKey] ?? null;
}
```
> These anchors encode mainstream 4th-down analytics; curate/extend against an actual published model at review time. They must be *unambiguous* consensus cases (the harness measures agreement, so a debatable anchor pollutes the metric).

- [ ] **Step 4: Re-export from the pack index**

Edit `libs/gridiron-pack/src/index.ts` — add:
```ts
export * from './oracle/fourth-down-oracle.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/oracle/fourth-down-oracle.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/gridiron-pack/src/oracle/fourth-down-oracle.ts libs/gridiron-pack/src/oracle/fourth-down-oracle.spec.ts libs/gridiron-pack/src/index.ts
git commit -m "feat(gridiron): curated 4th-down oracle fixture + lookup"
```

---

## Task 2: Comparator + readout enrichment (pack)

**Files:**
- Create: `libs/gridiron-pack/src/oracle/oracle-comparison.ts`
- Test: `libs/gridiron-pack/src/oracle/oracle-comparison.spec.ts`
- Modify: `libs/gridiron-pack/src/inference/situation-readout.ts`, `libs/gridiron-pack/src/index.ts`

- [ ] **Step 1: Add the optional oracle fields to `SituationReadout`**

Edit `libs/gridiron-pack/src/inference/situation-readout.ts` — extend the interface (do NOT change the reducer; enrichment is separate):
```ts
export interface SituationReadout {
  situationKey: string;
  arms: readonly RankedArm[];
  recommendedArm: Arm;
  statusQuoArm: Arm;
  liftMean: number;
  direction: Direction;
  oracleArm?: Arm;            // the curated consensus arm, when this situation is an anchor
  agreesWithOracle?: boolean; // recommendedArm === oracleArm
}
```

- [ ] **Step 2: Write the failing test**

```ts
// libs/gridiron-pack/src/oracle/oracle-comparison.spec.ts
import { describe, expect, it } from 'vitest';
import type { SituationReadout } from '../inference/situation-readout.js';
import { compareToOracle, withOracle } from './oracle-comparison.js';

const base = (situationKey: string, recommendedArm: 'go' | 'punt' | 'kick'): SituationReadout => ({
  situationKey, recommendedArm, statusQuoArm: 'punt', liftMean: 0.3, direction: 'improves',
  arms: [{ decision: recommendedArm, mean: 0.3, p10: -0.5, p50: 0.3, p90: 1.1, sd: 0.7 }],
});

describe('withOracle', () => {
  it('annotates agreement when the situation is an anchor', () => {
    const out = withOracle(base('short|opp-side|trail|q4-early', 'go'));
    expect(out.oracleArm).toBe('go');
    expect(out.agreesWithOracle).toBe(true);
  });
  it('flags disagreement', () => {
    const out = withOracle(base('long|own-deep|close|1st-half', 'go')); // oracle says punt
    expect(out.oracleArm).toBe('punt');
    expect(out.agreesWithOracle).toBe(false);
  });
  it('leaves oracle fields undefined for non-anchors', () => {
    const out = withOracle(base('medium|midfield|lead|q3', 'kick'));
    expect(out.oracleArm).toBeUndefined();
    expect(out.agreesWithOracle).toBeUndefined();
  });
});

describe('compareToOracle', () => {
  it('computes agreement rate + mismatches over readouts that are anchors', () => {
    const readouts = [
      withOracle(base('short|opp-side|trail|q4-early', 'go')),   // agree
      withOracle(base('long|own-deep|close|1st-half', 'go')),    // mismatch (oracle punt)
      withOracle(base('medium|fringe|close|q4-early', 'kick')),  // agree
      withOracle(base('medium|midfield|lead|q3', 'go')),         // not an anchor → ignored
    ];
    const cmp = compareToOracle(readouts);
    expect(cmp.total).toBe(3);
    expect(cmp.agreements).toBe(2);
    expect(cmp.agreementRate).toBeCloseTo(2 / 3, 5);
    expect(cmp.mismatches).toEqual([
      { situationKey: 'long|own-deep|close|1st-half', kernelArm: 'go', oracleArm: 'punt' },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/oracle/oracle-comparison.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// libs/gridiron-pack/src/oracle/oracle-comparison.ts
import type { Arm } from '../archetype/archetype.js';
import type { SituationReadout } from '../inference/situation-readout.js';
import { oracleRecommendation } from './fourth-down-oracle.js';

/** Annotate a readout with the curated oracle arm + agreement (when the situation is an anchor). */
export function withOracle(readout: SituationReadout): SituationReadout {
  const oracleArm = oracleRecommendation(readout.situationKey);
  if (oracleArm === null) return readout;
  return { ...readout, oracleArm, agreesWithOracle: readout.recommendedArm === oracleArm };
}

export interface OracleMismatch {
  situationKey: string;
  kernelArm: Arm;
  oracleArm: Arm;
}

export interface OracleComparison {
  total: number; // readouts that are anchors
  agreements: number;
  agreementRate: number; // 0..1 (0 when total === 0)
  mismatches: readonly OracleMismatch[];
}

/** Agreement metric over readouts; only those with an `oracleArm` count. */
export function compareToOracle(readouts: readonly SituationReadout[]): OracleComparison {
  const anchors = readouts.filter((r) => r.oracleArm !== undefined);
  const mismatches: OracleMismatch[] = anchors
    .filter((r) => r.recommendedArm !== r.oracleArm)
    .map((r) => ({ situationKey: r.situationKey, kernelArm: r.recommendedArm, oracleArm: r.oracleArm! }));
  const agreements = anchors.length - mismatches.length;
  return {
    total: anchors.length,
    agreements,
    agreementRate: anchors.length === 0 ? 0 : agreements / anchors.length,
    mismatches,
  };
}
```

- [ ] **Step 5: Re-export from the pack index**

Edit `libs/gridiron-pack/src/index.ts` — add:
```ts
export * from './oracle/oracle-comparison.js';
```

- [ ] **Step 6: Run the full pack suite**

Run: `pnpm --filter @de-braighter/gridiron-pack test`
Expected: PASS (oracle + comparison + all prior specs).

- [ ] **Step 7: Commit**

```bash
git add libs/gridiron-pack/src/oracle/oracle-comparison.ts libs/gridiron-pack/src/oracle/oracle-comparison.spec.ts libs/gridiron-pack/src/inference/situation-readout.ts libs/gridiron-pack/src/index.ts
git commit -m "feat(gridiron): oracle agreement comparator + readout enrichment"
```

---

## Task 3: Enrich the readout response (api)

**Files:**
- Modify: `apps/gridiron-api/src/readout/situation-readout.service.ts`
- Test: `apps/gridiron-api/src/readout/situation-readout.service.spec.ts` (extend slice-2 spec)

- [ ] **Step 1: Add the failing assertion to the service spec**

Append to `situation-readout.service.spec.ts` (reuse the slice-2 mock setup):

```ts
  it('annotates the response with the oracle arm + agreement for an anchor situation', async () => {
    const meanByArm: Record<string, number> = { go: 0.42, punt: -0.1, kick: 0.05 };
    const posterior = vi.fn().mockImplementation(async (input: { subject: { id: string } }) => {
      const key = 'short|opp-side|trail|q4-early';
      const { armSubjects } = await import('@de-braighter/gridiron-pack');
      const arm = armSubjects(key).find((s) => s.subjectId === input.subject.id)!.decision;
      return { ok: true, value: { summary: { mean: meanByArm[arm], p10: 0, p50: 0, p90: 0, sd: 0.5 } } };
    });
    const moduleRef = await Test.createTestingModule({
      providers: [SituationReadoutService, { provide: INFERENCE_BACKBONE, useValue: { posterior } }],
    }).compile();
    const out = await moduleRef.get(SituationReadoutService).readout({
      distance: 'short', field: 'opp-side', score: 'trail', time: 'q4-early',
    });
    expect(out.oracleArm).toBe('go');
    expect(out.agreesWithOracle).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/readout/situation-readout.service.spec.ts`
Expected: FAIL — `oracleArm` is undefined.

- [ ] **Step 3: Wrap the reducer output with `withOracle`**

Edit `situation-readout.service.ts`: import `withOracle` and wrap the return:
```ts
import { /* …existing… */ reduceSituationReadout, withOracle } from '@de-braighter/gridiron-pack';
// …
    return withOracle(reduceSituationReadout(key, posteriors));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/readout/situation-readout.service.spec.ts`
Expected: PASS (both slice-2 and the new oracle assertion).

- [ ] **Step 5: Commit**

```bash
git add apps/gridiron-api/src/readout/situation-readout.service.ts apps/gridiron-api/src/readout/situation-readout.service.spec.ts
git commit -m "feat(gridiron): readout annotates oracle agreement"
```

---

## Task 4: Standalone validation harness (api)

**Files:**
- Create: `apps/gridiron-api/src/validation/oracle-report.ts`
- Test: `apps/gridiron-api/src/validation/oracle-report.spec.ts`
- Create: `apps/gridiron-api/src/validation/validate-oracle.main.ts`
- Modify: `apps/gridiron-api/package.json` (add `validate:oracle` script)

- [ ] **Step 1: Write the failing test for the pure report formatter**

```ts
// apps/gridiron-api/src/validation/oracle-report.spec.ts
import { describe, expect, it } from 'vitest';
import { formatOracleReport } from './oracle-report.js';

describe('formatOracleReport', () => {
  it('renders the agreement rate + mismatch lines', () => {
    const text = formatOracleReport({
      total: 3, agreements: 2, agreementRate: 2 / 3,
      mismatches: [{ situationKey: 'long|own-deep|close|1st-half', kernelArm: 'go', oracleArm: 'punt' }],
    });
    expect(text).toContain('agreement: 2/3 (66.7%)');
    expect(text).toContain('long|own-deep|close|1st-half: kernel=go oracle=punt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/validation/oracle-report.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the report formatter**

```ts
// apps/gridiron-api/src/validation/oracle-report.ts
import type { OracleComparison } from '@de-braighter/gridiron-pack';

export function formatOracleReport(cmp: OracleComparison): string {
  const pct = (cmp.agreementRate * 100).toFixed(1);
  const lines = [
    `[gridiron oracle] agreement: ${cmp.agreements}/${cmp.total} (${pct}%)`,
    ...cmp.mismatches.map((m) => `  mismatch ${m.situationKey}: kernel=${m.kernelArm} oracle=${m.oracleArm}`),
  ];
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/validation/oracle-report.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the standalone harness entrypoint**

```ts
// apps/gridiron-api/src/validation/validate-oracle.main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ORACLE_ARCHETYPES, compareToOracle, type SituationReadout } from '@de-braighter/gridiron-pack';
import { AppModule } from '../app/app.module.js';
import { SituationReadoutService } from '../readout/situation-readout.service.js';
import { formatOracleReport } from './oracle-report.js';

function archetypeFromKey(key: string) {
  const [distance, field, score, time] = key.split('|');
  return { distance, field, score, time } as never;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const service = app.get(SituationReadoutService);
    const readouts: SituationReadout[] = [];
    for (const key of Object.keys(ORACLE_ARCHETYPES)) {
      readouts.push(await service.readout(archetypeFromKey(key)));
    }
    const cmp = compareToOracle(readouts);
    console.log(formatOracleReport(cmp));
    // Consistency-check sanity bar (NOT a hard CI gate — depends on ingested data):
    if (cmp.total > 0 && cmp.agreementRate < 0.7) {
      console.warn(`[gridiron oracle] agreement below 0.70 — inspect mismatches / data coverage`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[gridiron oracle] failed', err);
  process.exit(1);
});
```

- [ ] **Step 6: Add the npm script**

Edit `apps/gridiron-api/package.json` `scripts`:
```json
"validate:oracle": "node dist/validation/validate-oracle.main.js"
```

- [ ] **Step 7: Commit**

```bash
git add apps/gridiron-api/src/validation apps/gridiron-api/package.json
git commit -m "feat(gridiron): standalone oracle-agreement validation harness"
```

---

## Task 5: "vs. the bot" badge (web)

**Files:**
- Modify: `apps/gridiron-web/src/app/data/situation-readout.wire.ts`
- Modify: `apps/gridiron-web/src/app/what-if/arms-display.component.ts`
- Test: `apps/gridiron-web/src/app/what-if/arms-display.component.spec.ts` (extend slice-3 spec)

- [ ] **Step 1: Allow the oracle fields in the wire schema**

Edit `situation-readout.wire.ts` — add to `SituationReadoutWireSchema`:
```ts
  oracleArm: z.enum(['go', 'punt', 'kick']).optional(),
  agreesWithOracle: z.boolean().optional(),
```

- [ ] **Step 2: Add the failing badge assertion**

Append to `arms-display.component.spec.ts`:
```ts
  it('renders a "vs. the bot" badge with text (not color alone) when the oracle is present', () => {
    const fixture = TestBed.createComponent(ArmsDisplayComponent);
    fixture.componentRef.setInput('readout', { ...readout, oracleArm: 'go', agreesWithOracle: true });
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('.oracle-badge');
    expect(badge?.textContent).toContain('agrees with the 4th-down bot');
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/what-if/arms-display.component.spec.ts`
Expected: FAIL — no `.oracle-badge`.

- [ ] **Step 4: Add the badge to the template**

In `arms-display.component.ts`, add after the recommendation paragraph:
```html
      @if (r.agreesWithOracle !== undefined) {
        <p class="oracle-badge" [class.agree]="r.agreesWithOracle" [class.differ]="!r.agreesWithOracle">
          {{ r.agreesWithOracle ? '✓ agrees with the 4th-down bot' : '✗ differs from the 4th-down bot (bot: ' + r.oracleArm + ')' }}
        </p>
      }
```
And add to `styles`:
```css
    .oracle-badge.agree { color: var(--accent, #1a7f37); }
    .oracle-badge.differ { color: var(--warn, #b3261e); }
```
> Direction conveyed by the ✓/✗ glyph + words, never color alone (WCAG 1.4.1).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/what-if/arms-display.component.spec.ts`
Expected: PASS (slice-3 assertions + the badge).

- [ ] **Step 6: Commit**

```bash
git add apps/gridiron-web/src/app/data/situation-readout.wire.ts apps/gridiron-web/src/app/what-if/arms-display.component.ts apps/gridiron-web/src/app/what-if/arms-display.component.spec.ts
git commit -m "feat(gridiron-web): vs-the-bot oracle agreement badge"
```

---

## Task 6: Live verification (agreement rate + badge)

**Verification task (not TDD).** Requires ingested data (slice 1/2). Run from `domains/gridiron/`.

- [ ] **Step 1: Run the harness against ingested data**

Run:
```bash
# ensure data is ingested (slice 2, step 1) and the db is up
pnpm --filter @de-braighter/gridiron-api build
pnpm --filter @de-braighter/gridiron-api validate:oracle
```
Expected: `[gridiron oracle] agreement: N/M (xx.x%)` over the curated anchors, with any mismatch lines. On 3 seasons of data the agreement should clear the 0.70 sanity bar for the high-consensus anchors (short-yardage → go, backed-up-long → punt, FG-range → kick).

- [ ] **Step 2: Confirm the UI badge**

Start api + web (slice 3, step 1), open `http://localhost:4300`, select an anchor situation (e.g. distance=short, field=opp-side, score=trail, time=q4-early). Expected: the "✓ agrees with the 4th-down bot" badge appears; pick a deliberately contrarian-looking situation among the anchors and confirm the "✗ differs" branch renders when the kernel and oracle disagree.

- [ ] **Step 3: Record the result + the honest caveat in the README**

Append a "Slice 4 — oracle validation" section to `domains/gridiron/README.md` stating the agreement rate AND the caveat: *this is a consistency check (EPA ingested → EPA pooled); independent validation arrives with Approach B (`rawOutcome` indicator).* Then:
```bash
git add domains/gridiron/README.md
git commit -m "docs(gridiron): slice-4 oracle validation result + consistency-check caveat"
```

---

## Self-Review

**Spec coverage (§9 + §8 badge):** curated oracle fixture ✅ (Task 1); pure agreement comparator + mismatches ✅ (Task 2); readout enrichment ✅ (Tasks 2–3); standalone harness + agreement report ✅ (Task 4); UI "vs. the bot" badge ✅ (Task 5); the consistency-check caveat is stated in the harness framing + README (Task 6) per §9's honest framing.

**Placeholder scan:** No deferred-work steps; all code shown. The `>` notes are curate-the-anchors / WCAG reminders, not placeholders.

**Type consistency:** `Arm` literals (`go`/`punt`/`kick`), `situationKey` 4-part format, `SituationReadout` extended with optional `oracleArm`/`agreesWithOracle` (consumed identically in `withOracle`, the service, the wire schema, and the badge), `OracleComparison {total, agreements, agreementRate, mismatches}` used by both `compareToOracle` and `formatOracleReport`. The harness reconstructs the archetype from the fixture key with the same `|` order as `situationKey`.

**Scope:** Closes the slice arc — the kernel's recommendations are now measured against the public consensus, with the honest consistency-vs-independent framing carried into the artifact. Approach B (independent `rawOutcome` validation) and #3 (interaction-aware inference) remain future work, unblocked by the B-ready ingestion from slice 1.
