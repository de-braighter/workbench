# S3 — AI rework cost (`ai-rework`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the producer-attributed churn join to the SDLC twin — an authored-side AI-vs-human churn gap, a rewriter-side `rewrittenBy→producer` breakdown, and a producer-agnostic `self-churn` declarable indicator — all as composition over the existing engine.

**Architecture:** Enrich `ChurnObserved` additively with per-rewriter line counts (git fact); add a collapse-per-PR reader; register a `self-churn` indicator (whatif) + reconcile observer + an `ai-vs-human` general lever; compose a pure `ai-rework` readout (mirrors `net-flow.ts`). The producer of a rewriter is DERIVED at query time by joining to `ProducerAttributed` — never stored. No posterior re-derived; the join is the only new derivation.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), Zod schemas, vitest. Repo: `domains/devloop` on branch `feat/s3-ai-rework-cost`.

**Design:** `domains/devloop/docs/s3-ai-rework-cost-design.md`. **ADR:** ADR-271 (`layers/specs/adr/adr-271-ai-rework-cost.md`, proposed).

## Global Constraints

- **REUSE, don't reinvent.** Compose `whatIf` + the existing producer/model levers. NO posteriors re-derived; `self-churn` reuses the existing `betaPosterior` fit. NO honesty logic re-implemented.
- **Store generators, derive graphs.** The rewriter's producer is DERIVED at query time from `ProducerAttributed`; NEVER stored on `ChurnObserved`. `rewrittenByLines` carries only PR refs + raw git line counts.
- **Decision aid, never a gate, never causal.** TREND/WARN only. Monoculture → the authored AI-vs-human gap is INCONCLUSIVE; say so, don't fabricate. Goodhart: score `self-churn`, don't chase it.
- **CFR / prod-deploy DORA half stays OUT** (no data).
- **Determinism in the analyzable core.** Inject `now`/`ts`; NO `Date.now()`/`new Date()` in pure logic. MC posteriors (`betaPosterior`) → test composition with synthetic hand-built fixtures + verdict/attribution-only asserts; the rewriter breakdown is exact counting → assert exact shares.
- **Gate (authoritative, local):** `npm run typecheck` (`tsc --noEmit`) + `npm run test` (`vitest run`) + `npx knip`. Un-export in-file-only helpers (knip). Pre-push hook runs typecheck+test.
- **"self" identity** = the full attribution `actorKey = `${producer}/${model}``. `cross-ai` = both AI-attributed (`providerOf(model) !== 'unknown'`) but different `actorKey`. `human` = positively-marked (`producer === 'human'`; empty today). `unattributed` = rewriter (or authored PR) lacking a `ProducerAttributed`.

---

### Task 1: Enrich `ChurnObserved` with `rewrittenByLines` (additive event field)

**Files:**
- Modify: `src/events.ts` (the `ChurnObserved` zod object + its doc comment, ~lines 74-91)
- Test: `test/churn-event.test.ts`

**Interfaces:**
- Produces: `ChurnObservedPayload.rewrittenByLines: { pr: number; lines: number }[]` (optional in input, default `[]`). Invariant: `rewrittenByLines` is empty OR `Σ lines === churned`.

- [ ] **Step 1: Write the failing tests** — append to `test/churn-event.test.ts`:

```ts
import { churnObserved } from '../src/events.js';

describe('ChurnObserved rewrittenByLines (S3 additive enrichment)', () => {
  const base = { repo: 'r', pr: 1, mergedAt: '2026-01-01T00:00:00.000Z', authored: 10, churned: 4, ratio: 0.4, ts: '2026-02-01T00:00:00.000Z' };

  it('defaults rewrittenByLines to [] when absent (v1 envelopes stay valid)', () => {
    const env = churnObserved({ ...base, rewrittenBy: [2] });
    expect((env.payload as any).rewrittenByLines).toEqual([]);
  });

  it('accepts per-rewriter line counts when Σ lines === churned', () => {
    const env = churnObserved({ ...base, rewrittenBy: [2, 3], rewrittenByLines: [{ pr: 2, lines: 3 }, { pr: 3, lines: 1 }] });
    expect((env.payload as any).rewrittenByLines).toEqual([{ pr: 2, lines: 3 }, { pr: 3, lines: 1 }]);
  });

  it('rejects rewrittenByLines whose Σ lines !== churned', () => {
    expect(() => churnObserved({ ...base, rewrittenBy: [2], rewrittenByLines: [{ pr: 2, lines: 99 }] })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/churn-event.test.ts` → FAIL (`rewrittenByLines` undefined / no throw).

- [ ] **Step 3: Implement** — in `src/events.ts`, add the field to the `ChurnObserved` object and extend the `.refine` (keep the existing `churned <= authored` refine; add the sum invariant). Update the doc comment to mention `rewrittenByLines` = per-rewriter git-derived line counts (producer still derived at query time):

```ts
const ChurnObserved = z
  .object({
    repo: z.string(),
    pr: z.number().int(),
    mergedAt: z.string(),
    authored: z.number().int().nonnegative(),
    churned: z.number().int().nonnegative(),
    ratio: z.number().min(0).max(1),
    windowDays: z.number().int().positive().default(14),
    windowClosed: z.literal(true).default(true),
    rewrittenBy: z.array(z.number().int()).default([]),
    // S3: per-rewriter churned-line counts (git fact). Σ lines === churned when present.
    // The rewriter's PRODUCER is NOT stored — derived at query-time via ProducerAttributed.
    rewrittenByLines: z.array(z.object({ pr: z.number().int(), lines: z.number().int().nonnegative() })).default([]),
  })
  .refine((v) => v.churned <= v.authored, { message: 'churned cannot exceed authored' })
  .refine((v) => v.rewrittenByLines.length === 0 || v.rewrittenByLines.reduce((s, x) => s + x.lines, 0) === v.churned,
    { message: 'Σ rewrittenByLines.lines must equal churned' });
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/churn-event.test.ts` → PASS. Then `npx vitest run test/events.test.ts` → still PASS (regression).

- [ ] **Step 5: Commit**

```bash
git add src/events.ts test/churn-event.test.ts
git commit -m "feat(devloop): ChurnObserved.rewrittenByLines — additive per-rewriter line counts (S3)"
```

---

### Task 2: Populate `rewrittenByLines` in the churn ingester

**Files:**
- Modify: `src/ingest/churn.ts` (`ChurnRow` interface, `computeChurn`, `runChurn`)
- Test: `test/churn.test.ts`

**Interfaces:**
- Consumes: `ChurnObservedPayload.rewrittenByLines` (Task 1).
- Produces: `ChurnRow.rewrittenByLines: { pr: number; lines: number }[]` (sorted by `pr`, `Σ lines === churned`); `runChurn` forwards it to `churnObserved`.

- [ ] **Step 1: Write the failing test** — append to the `describe('computeChurn', …)` block in `test/churn.test.ts`:

```ts
  it('attributes churned lines per rewriter PR (rewrittenByLines), summing to churned', () => {
    // PR #1 authors 10 lines; PR #2 deletes 3 of them (day 3); PR #3 deletes 2 more (day 6).
    commitAt(dir, '2026-01-01T00:00:00Z', { 'a.ts': lines(10) }, 'feat: a (#1)');
    commitAt(dir, '2026-01-04T00:00:00Z', { 'a.ts': lines(7, 3) }, 'fix: trim3 (#2)'); // drops line0..2 (3 lines)
    commitAt(dir, '2026-01-07T00:00:00Z', { 'a.ts': lines(5, 5) }, 'fix: trim2 (#3)'); // drops line3..4 (2 lines)
    const a = computeChurn(dir, Date.parse('2026-03-01T00:00:00Z')).find((r) => r.pr === 1)!;
    expect(a.churned).toBe(5);
    expect(a.rewrittenBy).toEqual([2, 3]);
    expect(a.rewrittenByLines).toEqual([{ pr: 2, lines: 3 }, { pr: 3, lines: 2 }]);
    expect(a.rewrittenByLines.reduce((s, x) => s + x.lines, 0)).toBe(a.churned);
  });
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/churn.test.ts -t rewrittenByLines` → FAIL (`rewrittenByLines` undefined on `ChurnRow`).

- [ ] **Step 3: Implement** — in `src/ingest/churn.ts`:

  1. Extend the interface: `export interface ChurnRow { pr: number; mergedAtMs: number; authored: number; churned: number; ratio: number; rewrittenBy: number[]; rewrittenByLines: { pr: number; lines: number }[] }`.
  2. In `computeChurn`, add a per-origin per-rewriter accumulator alongside `rewrittenBy`: `const rewrittenLines = new Map<string, Map<number, number>>();` (originSha → rewriterPr → lineCount). Inside the deletion loop, where the code currently does the `rewrittenBy` set update (the `if (b.pr !== undefined) { … }` block after `churned.set(...)`), ALSO increment the per-rewriter count:

```ts
        churned.set(originSha, (churned.get(originSha) ?? 0) + 1);
        if (b.pr !== undefined) {
          const s = rewrittenBy.get(originSha) ?? new Set<number>();
          s.add(b.pr);
          rewrittenBy.set(originSha, s);
          const lm = rewrittenLines.get(originSha) ?? new Map<number, number>();
          lm.set(b.pr, (lm.get(b.pr) ?? 0) + 1);
          rewrittenLines.set(originSha, lm);
        }
```

  3. In the row-emit loop, build `rewrittenByLines` sorted by `pr`:

```ts
    const lm = rewrittenLines.get(c.sha) ?? new Map<number, number>();
    const rbl = [...lm.entries()].map(([pr, l]) => ({ pr, lines: l })).sort((x, y) => x.pr - y.pr);
    rows.push({ pr: c.pr, mergedAtMs: c.dateMs, authored: a, churned: ch, ratio: ch / a, rewrittenBy: [...(rewrittenBy.get(c.sha) ?? [])].sort((x, y) => x - y), rewrittenByLines: rbl });
```

  4. In `runChurn`, pass it through: add `rewrittenByLines: r.rewrittenByLines` to the `churnObserved({...})` call.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/churn.test.ts` → all PASS (the new case + the existing `rewrittenBy`/`churned` cases still green).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/churn.ts test/churn.test.ts
git commit -m "feat(devloop): churn ingester accumulates per-rewriter line counts (S3)"
```

---

### Task 3: `churnByPr` + `producerByPr` readers (collapse-per-PR + the join lookup)

**Files:**
- Create: `src/inference/churn-read.ts`
- Test: `test/churn-read.test.ts`

**Interfaces:**
- Consumes: `ChurnObservedPayload` (Task 1), `ProducerPayload`, `EVENT`, `ofType`.
- Produces:
  - `churnByPr(events: DomainEventEnvelope[], repo: string): Map<number, ChurnObservedPayload>` — one row per `(repo,pr)`, preferring the record WITH a non-empty `rewrittenByLines`.
  - `producerByPr(events: DomainEventEnvelope[], repo: string): Map<number, { producer: string; model: string }>` — latest `ProducerAttributed` per PR.
  - `actorKey(p: { producer: string; model: string }): string` → `` `${p.producer}/${p.model}` ``.

- [ ] **Step 1: Write the failing test** — create `test/churn-read.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { churnByPr, producerByPr, actorKey } from '../src/inference/churn-read.js';
import { churnObserved, producer } from '../src/events.js';

const repo = 'r';
const ts = '2026-02-01T00:00:00.000Z';

describe('churnByPr', () => {
  it('collapses duplicate ChurnObserved for one PR, preferring the enriched (rewrittenByLines) record', () => {
    const bare = churnObserved({ repo, pr: 1, mergedAt: ts, authored: 10, churned: 4, ratio: 0.4, rewrittenBy: [2], ts });
    const rich = churnObserved({ repo, pr: 1, mergedAt: ts, authored: 10, churned: 4, ratio: 0.4, rewrittenBy: [2], rewrittenByLines: [{ pr: 2, lines: 4 }], ts });
    const m = churnByPr([bare, rich], repo);
    expect(m.size).toBe(1);
    expect(m.get(1)!.rewrittenByLines).toEqual([{ pr: 2, lines: 4 }]); // enriched preferred regardless of order
    const m2 = churnByPr([rich, bare], repo);
    expect(m2.get(1)!.rewrittenByLines).toEqual([{ pr: 2, lines: 4 }]);
  });

  it('scopes to the repo', () => {
    const a = churnObserved({ repo, pr: 1, mergedAt: ts, authored: 5, churned: 1, ratio: 0.2, ts });
    const b = churnObserved({ repo: 'other', pr: 9, mergedAt: ts, authored: 5, churned: 1, ratio: 0.2, ts });
    expect([...churnByPr([a, b], repo).keys()]).toEqual([1]);
  });
});

describe('producerByPr + actorKey', () => {
  it('maps each PR to its producer/model and builds the actorKey', () => {
    const m = producerByPr([producer({ repo, pr: 1, producer: 'orchestrator', model: 'claude-opus-4-8', ts })], repo);
    expect(m.get(1)).toEqual({ producer: 'orchestrator', model: 'claude-opus-4-8' });
    expect(actorKey(m.get(1)!)).toBe('orchestrator/claude-opus-4-8');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/churn-read.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/inference/churn-read.ts`:

```ts
// Query-time readers over the churn + producer streams. The rewriter's producer is
// joined HERE (store generators, derive graphs) — never stored on ChurnObserved.
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { ofType } from '../log.js';
import { EVENT, type ChurnObservedPayload, type ProducerPayload } from '../events.js';

/** One ChurnObserved per (repo,pr), preferring the record carrying rewrittenByLines.
 *  Re-running `churn` after the S3 enrichment double-emits (payload changed → new
 *  dedupKey); this collapse makes all churn readers append-only-safe + double-count-free. */
export function churnByPr(events: DomainEventEnvelope[], repo: string): Map<number, ChurnObservedPayload> {
  const m = new Map<number, ChurnObservedPayload>();
  for (const e of ofType(events, EVENT.CHURN_OBSERVED)) {
    const p = e.payload as unknown as ChurnObservedPayload;
    if (p.repo !== repo) continue;
    const prev = m.get(p.pr);
    if (!prev || (prev.rewrittenByLines.length === 0 && p.rewrittenByLines.length > 0)) m.set(p.pr, p);
  }
  return m;
}

/** Latest ProducerAttributed per PR in `repo`. */
export function producerByPr(events: DomainEventEnvelope[], repo: string): Map<number, { producer: string; model: string }> {
  const m = new Map<number, { producer: string; model: string }>();
  for (const e of ofType(events, EVENT.PRODUCER)) {
    const p = e.payload as unknown as ProducerPayload;
    if (p.repo === repo) m.set(p.pr, { producer: p.producer, model: p.model });
  }
  return m;
}

export const actorKey = (p: { producer: string; model: string }): string => `${p.producer}/${p.model}`;
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/churn-read.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inference/churn-read.ts test/churn-read.test.ts
git commit -m "feat(devloop): churnByPr + producerByPr readers (collapse-per-PR + the producer join) (S3)"
```

---

### Task 4: `self-churn` indicator + refactor `short-term-churn` onto `churnByPr`

**Files:**
- Modify: `src/inference/whatif.ts` (imports; `INDICATORS` — refactor `short-term-churn`, add `self-churn`)
- Test: `test/self-churn-indicator.test.ts`

**Interfaces:**
- Consumes: `churnByPr`, `producerByPr`, `actorKey` (Task 3); `betaPosterior`.
- Produces: `INDICATORS['self-churn']` (unit `probability`, lower-is-better, line-weighted Beta). Per PR `p` with producer `Q`: `self_churned = Σ lines` over `rewrittenByLines` whose rewriter `actorKey === actorKey(Q)`; observed value = `self_churned / authored`; weight = `authored`. PRs with no `ProducerAttributed` are omitted (no `Q`).

- [ ] **Step 1: Write the failing test** — create `test/self-churn-indicator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { whatIf } from '../src/inference/whatif.js';
import { churnObserved, producer, prMerged } from '../src/events.js';

const repo = 'r';
const prod = (pr: number, p: string, model: string, ts: string) => producer({ repo, pr, producer: p, model, ts });
const merged = (pr: number, ts: string) => prMerged({ repo, pr, title: `PR ${pr}`, cycleHours: 1, ts });
const churn = (pr: number, authored: number, rbl: { pr: number; lines: number }[], ts: string) => {
  const churnedN = rbl.reduce((s, x) => s + x.lines, 0);
  return churnObserved({ repo, pr, mergedAt: ts, authored, churned: churnedN, ratio: churnedN / authored, rewrittenBy: rbl.map((x) => x.pr), rewrittenByLines: rbl, ts });
};

describe('self-churn indicator (the rewrittenBy→producer join)', () => {
  it('counts ONLY lines whose rewriter shares the authored actorKey; cross-producer + unattributed rewriters do NOT count as self', () => {
    // 5 PRs by orchestrator/opus, each authoring 100 lines. Rewriters:
    //   - even PRs (2,4) rewritten by a SELF PR (#50, orchestrator/opus): 10 self lines each
    //   - odd PRs (1,3,5) rewritten by a CROSS PR (#60, orchestrator/sonnet): 10 cross lines each
    const tss = ['2026-02-01','2026-02-05','2026-02-09','2026-02-13','2026-02-17'].map((d) => `${d}T00:00:00.000Z`);
    const events = [
      prod(50, 'orchestrator', 'claude-opus-4-8', tss[0]!),    // the self-rewriter
      prod(60, 'orchestrator', 'claude-sonnet-4-6', tss[0]!),  // the cross-rewriter
      ...[1, 2, 3, 4, 5].flatMap((pr, i) => [
        prod(pr, 'orchestrator', 'claude-opus-4-8', tss[i]!),
        merged(pr, tss[i]!),
        churn(pr, 100, pr % 2 === 0 ? [{ pr: 50, lines: 10 }] : [{ pr: 60, lines: 10 }], tss[i]!),
      ]),
    ];
    const w = whatIf(events, { repo, indicator: 'self-churn', by: 'model' });
    expect(w.unit).toBe('probability');
    expect(w.higherIsBetter).toBe(false);
    const opus = w.strata.find((s) => s.value === 'claude-opus-4-8')!;
    // self lines = 2 PRs × 10 = 20; authored total = 500 → 20/500 = 0.04 (NOT 50/500=0.10 if cross counted)
    expect(opus.point).toBeCloseTo(0.04, 2);
  });

  it('an unattributed rewriter contributes ZERO self lines (never silently self)', () => {
    const tss = ['2026-02-01','2026-02-05','2026-02-09','2026-02-13','2026-02-17'].map((d) => `${d}T00:00:00.000Z`);
    const events = [
      // rewriter #70 has NO ProducerAttributed → unattributed
      ...[1, 2, 3, 4, 5].flatMap((pr, i) => [
        prod(pr, 'orchestrator', 'claude-opus-4-8', tss[i]!),
        merged(pr, tss[i]!),
        churn(pr, 100, [{ pr: 70, lines: 10 }], tss[i]!),
      ]),
    ];
    const w = whatIf(events, { repo, indicator: 'self-churn', by: 'model' });
    const opus = w.strata.find((s) => s.value === 'claude-opus-4-8')!;
    expect(opus.point).toBeCloseTo(0, 2); // zero self lines
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/self-churn-indicator.test.ts` → FAIL (`self-churn` not in INDICATORS).

- [ ] **Step 3: Implement** — in `src/inference/whatif.ts`:
  1. Add import: `import { churnByPr, producerByPr, actorKey } from './churn-read.js';`.
  2. Refactor `short-term-churn`'s `observe` + `weight` to read from `churnByPr` (collapse-safe):

```ts
  'short-term-churn': {
    unit: 'probability',
    higherIsBetter: false,
    observe: (events, repo) => { const m = new Map<number, number>(); for (const [pr, p] of churnByPr(events, repo)) m.set(pr, p.ratio); return m; },
    weight: (events, repo) => { const m = new Map<number, number>(); for (const [pr, p] of churnByPr(events, repo)) m.set(pr, p.authored); return m; },
    fit: (v) => { /* unchanged */ let s = 0, f = 0; for (const r of v) { s += r; f += 1 - r; } const b = betaPosterior(s, f); return { point: b.mean, p10: b.p10, p90: b.p90 }; },
    fitWeighted: (pairs) => { let succ = 0, fail = 0; for (const [ratio, authored] of pairs) { const c = Math.round(ratio * authored); succ += c; fail += authored - c; } const b = betaPosterior(succ, fail); return { point: b.mean, p10: b.p10, p90: b.p90 }; },
  },
```

  3. Add the `self-churn` indicator (after `short-term-churn`):

```ts
  'self-churn': {
    unit: 'probability',
    higherIsBetter: false,
    // self-churn = lines an authored PR's OWN producer later deleted ÷ authored. The
    // rewriter→producer join is derived here from ProducerAttributed (store generators).
    observe: (events, repo) => {
      const prod = producerByPr(events, repo);
      const m = new Map<number, number>();
      for (const [pr, p] of churnByPr(events, repo)) {
        const mine = prod.get(pr); if (!mine) continue;      // unattributed authored PR → omit (no Q)
        const myKey = actorKey(mine);
        let self = 0;
        for (const r of p.rewrittenByLines) { const rp = prod.get(r.pr); if (rp && actorKey(rp) === myKey) self += r.lines; }
        if (p.authored > 0) m.set(pr, self / p.authored);
      }
      return m;
    },
    weight: (events, repo) => { const prod = producerByPr(events, repo); const m = new Map<number, number>(); for (const [pr, p] of churnByPr(events, repo)) if (prod.has(pr) && p.authored > 0) m.set(pr, p.authored); return m; },
    fit: (v) => { let s = 0, f = 0; for (const r of v) { s += r; f += 1 - r; } const b = betaPosterior(s, f); return { point: b.mean, p10: b.p10, p90: b.p90 }; },
    fitWeighted: (pairs) => { let succ = 0, fail = 0; for (const [ratio, authored] of pairs) { const c = Math.round(ratio * authored); succ += c; fail += authored - c; } const b = betaPosterior(succ, fail); return { point: b.mean, p10: b.p10, p90: b.p90 }; },
  },
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/self-churn-indicator.test.ts test/churn-indicator.test.ts test/whatif.test.ts` → all PASS (self-churn green + short-term-churn refactor regression-clean).

- [ ] **Step 5: Commit**

```bash
git add src/inference/whatif.ts test/self-churn-indicator.test.ts
git commit -m "feat(devloop): self-churn indicator via rewrittenBy->producer join; short-term-churn onto churnByPr (S3)"
```

---

### Task 5: `ai-vs-human` general lever

**Files:**
- Modify: `src/inference/whatif.ts` (`leverValues` + its support-guard)
- Test: `test/ai-vs-human-lever.test.ts`

**Interfaces:**
- Consumes: `providerOf` (already imported in whatif.ts), `EVENT.PRODUCER`, `ProducerPayload`.
- Produces: lever `by: 'ai-vs-human'` — `ai` ⟺ `ProducerAttributed` with `providerOf(model) !== 'unknown'`; `human` ⟺ `producer === 'human'`; PRs with no `ProducerAttributed` (or a non-AI, non-human producer) are excluded.

- [ ] **Step 1: Write the failing test** — create `test/ai-vs-human-lever.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { whatIf } from '../src/inference/whatif.js';
import { producer, prMerged } from '../src/events.js';

const repo = 'r';
const merged = (pr: number, h: number, ts: string) => prMerged({ repo, pr, title: 'x', cycleHours: h, ts });

describe('ai-vs-human lever', () => {
  it('classifies AI-model ProducerAttributed as "ai"; un-attributed PRs are EXCLUDED (never "human")', () => {
    const ts = (d: number) => `2026-05-${10 + d}T00:00:00.000Z`;
    const events = [
      ...[1, 2, 3, 4, 5].flatMap((pr, i) => [producer({ repo, pr, producer: 'orchestrator', model: 'claude-opus-4-8', ts: ts(i) }), merged(pr, 1, ts(i))]),
      merged(99, 1, ts(0)), // a PR with NO ProducerAttributed → excluded, NOT human
    ];
    const w = whatIf(events, { repo, indicator: 'cycle-time', by: 'ai-vs-human' });
    expect(w.strata.map((s) => s.value)).toEqual(['ai']);          // only the ai arm
    expect(w.strata.find((s) => s.value === 'human')).toBeUndefined();
    expect(w.warnings.some((x) => /lack a 'ai-vs-human' attribution/.test(x))).toBe(true); // PR 99 excluded
  });

  it('a positively-marked human producer classifies as "human"', () => {
    const ts = (d: number) => `2026-05-${10 + d}T00:00:00.000Z`;
    const events = [
      ...[1, 2, 3, 4, 5].flatMap((pr, i) => [producer({ repo, pr, producer: 'orchestrator', model: 'claude-opus-4-8', ts: ts(i) }), merged(pr, 1, ts(i))]),
      ...[6, 7, 8, 9, 10].flatMap((pr, i) => [producer({ repo, pr, producer: 'human', model: 'none', ts: ts(i) }), merged(pr, 1, ts(i))]),
    ];
    const w = whatIf(events, { repo, indicator: 'cycle-time', by: 'ai-vs-human' });
    expect(w.strata.map((s) => s.value).sort()).toEqual(['ai', 'human']);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/ai-vs-human-lever.test.ts` → FAIL (`ai-vs-human` not supported → empty strata).

- [ ] **Step 3: Implement** — in `src/inference/whatif.ts` `leverValues`:
  1. Extend the support guard (the early `return { values, ok: false }`) to recognise `ai-vs-human`:

```ts
  if (!CATEGORICAL.has(by) && !skill && !PR_DERIVED.has(by) && by !== 'effort' && by !== 'ai-vs-human') return { values, ok: false };
```

  2. In the `for (const e of ofType(events, EVENT.PRODUCER))` loop, add an `ai-vs-human` branch BEFORE the `effort`/`skill`/categorical branches:

```ts
    if (by === 'ai-vs-human') {
      if (p.producer === 'human') values.set(p.pr, 'human');
      else if (providerOf(p.model) !== 'unknown') values.set(p.pr, 'ai');
      // else: a non-AI, non-human ProducerAttributed (e.g. model 'unknown') → excluded
      continue;
    }
```

  3. Update the unsupported-lever warning string in `whatIf` (the `empty(...)` for `!ok`) to include `ai-vs-human` in the "try:" list.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/ai-vs-human-lever.test.ts test/whatif-pr-levers.test.ts test/whatif.test.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inference/whatif.ts test/ai-vs-human-lever.test.ts
git commit -m "feat(devloop): ai-vs-human general lever (ai=AI-attributed, human=marked, unattributed excluded) (S3)"
```

---

### Task 6: `self-churn` reconcile observer

**Files:**
- Modify: `src/ingest/observe.ts` (imports; add `observeSelfChurn`; register in `OBSERVERS`)
- Test: `test/observe.test.ts`

**Interfaces:**
- Consumes: `churnByPr`, `producerByPr`, `actorKey` (Task 3); `EffectDeclaredPayload`.
- Produces: `OBSERVERS['self-churn']` — for a declared `(repo, pr)`, the per-PR self-churn ratio (own-actorKey rewrites ÷ authored); `undefined` (⇒ deferred) when the `ChurnObserved` is absent (window open / pre-S3 event with empty `rewrittenByLines` cannot prove ratio) or the authored PR has no producer.

- [ ] **Step 1: Write the failing test** — append to `test/observe.test.ts` (mirror the existing `reconcileObservations` cases):

```ts
import { churnByPr } from '../src/inference/churn-read.js'; // (top of file if not present)

describe('self-churn observer (reconcile)', () => {
  const repo = 'r';
  const ts = '2026-02-01T00:00:00.000Z';
  const decl = (pr: number) => effectDeclared({ repo, pr, indicatorId: 'self-churn', predicted: 0.05, sd: 0.02, ts });

  it('observes own-producer churn ratio once the window is closed', async () => {
    const events = [
      producer({ repo, pr: 1, producer: 'orchestrator', model: 'claude-opus-4-8', ts }),
      producer({ repo, pr: 9, producer: 'orchestrator', model: 'claude-opus-4-8', ts }), // self rewriter
      churnObserved({ repo, pr: 1, mergedAt: ts, authored: 100, churned: 10, ratio: 0.1, rewrittenBy: [9], rewrittenByLines: [{ pr: 9, lines: 10 }], ts }),
      decl(1),
    ];
    const r = await reconcileObservations(events, ts);
    const obs = r.observed.find((e) => (e.payload as any).indicatorId === 'self-churn');
    expect((obs!.payload as any).observed).toBeCloseTo(0.1, 5); // 10 self / 100 authored
  });

  it('defers when no ChurnObserved exists yet (window still open)', async () => {
    const events = [producer({ repo, pr: 1, producer: 'orchestrator', model: 'claude-opus-4-8', ts }), decl(1)];
    const r = await reconcileObservations(events, ts);
    expect(r.deferred).toContain('self-churn@r#1');
  });

  it('defers when the authored PR has no producer (attribute can fill it)', async () => {
    const events = [
      churnObserved({ repo, pr: 1, mergedAt: ts, authored: 100, churned: 10, ratio: 0.1, rewrittenBy: [9], rewrittenByLines: [{ pr: 9, lines: 10 }], ts }),
      decl(1),
    ];
    const r = await reconcileObservations(events, ts);
    expect(r.deferred).toContain('self-churn@r#1');
  });
});
```

(Ensure `producer`, `churnObserved`, `effectDeclared` are imported at the top of `test/observe.test.ts`.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/observe.test.ts -t self-churn` → FAIL (no `self-churn` observer → declared-but-unhandled, not deferred-with-value).

- [ ] **Step 3: Implement** — in `src/ingest/observe.ts`:
  1. Add import: `import { churnByPr, producerByPr, actorKey } from '../inference/churn-read.js';`.
  2. Add the observer (mirrors `observeShortTermChurn`):

```ts
/** self-churn (S3): own-producer rewrites ÷ authored, joined at query-time. Deferred
 *  (undefined) when no closed-window ChurnObserved exists OR the authored PR has no producer. */
const observeSelfChurn: Observer = (decl, events) => {
  const row = churnByPr(events, decl.repo).get(decl.pr);
  if (!row) return undefined;
  const mine = producerByPr(events, decl.repo).get(decl.pr);
  if (!mine || row.authored <= 0) return undefined;
  const myKey = actorKey(mine);
  const prod = producerByPr(events, decl.repo);
  let self = 0;
  for (const r of row.rewrittenByLines) { const rp = prod.get(r.pr); if (rp && actorKey(rp) === myKey) self += r.lines; }
  return self / row.authored;
};
```

  3. Register in `OBSERVERS`: add `'self-churn': observeSelfChurn,`.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/observe.test.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/observe.ts test/observe.test.ts
git commit -m "feat(devloop): self-churn reconcile observer (deferred-not-faked) (S3)"
```

---

### Task 7: `ai-rework` composed module (rewriter breakdown + authored gap + readout)

**Files:**
- Create: `src/inference/ai-rework.ts`
- Test: `test/ai-rework.test.ts`

**Interfaces:**
- Consumes: `whatIf` (Tasks 4/5), `churnByPr`, `producerByPr`, `actorKey` (Task 3), `providerOf`.
- Produces:
  - `interface ReworkBreakdown { self: number; crossAi: number; human: number; unattributed: number; totalChurned: number }` (line counts) + `interface ReworkShares { self; crossAi; human; unattributed }` (fractions of `totalChurned`).
  - `rewriterBreakdown(events, repo): ReworkBreakdown` — exact line-weighted counts (deterministic).
  - `aiRework(events, { repo }): { repo; breakdown; shares; authoredGap: WhatIf; byModel: WhatIf; warnings: string[] }`.
  - `renderAiRework(ar): string[]`.

- [ ] **Step 1: Write the failing test** — create `test/ai-rework.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rewriterBreakdown, aiRework, renderAiRework } from '../src/inference/ai-rework.js';
import { churnObserved, producer, prMerged } from '../src/events.js';

const repo = 'r';
const prod = (pr: number, p: string, model: string, ts: string) => producer({ repo, pr, producer: p, model, ts });
const merged = (pr: number, ts: string) => prMerged({ repo, pr, title: `PR ${pr}`, cycleHours: 1, ts });
const churn = (pr: number, authored: number, rbl: { pr: number; lines: number }[], ts: string) => {
  const c = rbl.reduce((s, x) => s + x.lines, 0);
  return churnObserved({ repo, pr, mergedAt: ts, authored, churned: c, ratio: c / authored, rewrittenBy: rbl.map((x) => x.pr), rewrittenByLines: rbl, ts });
};

describe('rewriterBreakdown (line-weighted descriptive shares)', () => {
  it('buckets churned lines by rewriter relationship; unattributed never folded into self', () => {
    const ts = '2026-02-01T00:00:00.000Z';
    const events = [
      prod(1, 'orchestrator', 'claude-opus-4-8', ts),           // authored, opus
      prod(50, 'orchestrator', 'claude-opus-4-8', ts),          // SELF (same actorKey)
      prod(60, 'orchestrator', 'claude-sonnet-4-6', ts),        // CROSS-AI
      // rewriter 70 has NO producer → unattributed
      churn(1, 100, [{ pr: 50, lines: 12 }, { pr: 60, lines: 5 }, { pr: 70, lines: 3 }], ts),
    ];
    const b = rewriterBreakdown(events, repo);
    expect(b).toEqual({ self: 12, crossAi: 5, human: 0, unattributed: 3, totalChurned: 20 });
  });

  it('an authored PR with no producer puts ALL its churn in unattributed (no actorKey to compare)', () => {
    const ts = '2026-02-01T00:00:00.000Z';
    const events = [prod(50, 'orchestrator', 'claude-opus-4-8', ts), churn(1, 100, [{ pr: 50, lines: 10 }], ts)];
    const b = rewriterBreakdown(events, repo);
    expect(b).toEqual({ self: 0, crossAi: 0, human: 0, unattributed: 10, totalChurned: 10 });
  });
});

describe('aiRework authored-side gap', () => {
  it('monoculture (only an ai arm) → authored gap is INCONCLUSIVE', () => {
    const tss = ['2026-02-01','2026-02-05','2026-02-09','2026-02-13','2026-02-17'].map((d) => `${d}T00:00:00.000Z`);
    const events = [...[1, 2, 3, 4, 5].flatMap((pr, i) => [prod(pr, 'orchestrator', 'claude-opus-4-8', tss[i]!), merged(pr, tss[i]!), churn(pr, 100, [{ pr: 99, lines: 5 }], tss[i]!)])];
    const ar = aiRework(events, { repo });
    expect(ar.authoredGap.strata.map((s) => s.value)).toEqual(['ai']);   // one arm
    expect(ar.authoredGap.strata.length).toBeLessThan(2);                 // → whatIf INCONCLUSIVE
    expect(renderAiRework(ar).join('\n')).toMatch(/no identifiable human arm|INCONCLUSIVE/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/ai-rework.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/inference/ai-rework.ts`:

```ts
// ai-rework (S3): the producer-attributed churn join. Authored-side AI-vs-human gap
// (reuses whatIf) + rewriter-side line-weighted descriptive breakdown (the rewrittenBy→
// producer join, exact counting). TREND/WARN, never a gate. No posterior re-derived.
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { whatIf, type WhatIf } from './whatif.js';
import { churnByPr, producerByPr, actorKey } from './churn-read.js';
import { providerOf } from '../provider.js';

export interface ReworkBreakdown { self: number; crossAi: number; human: number; unattributed: number; totalChurned: number }
export interface ReworkShares { self: number; crossAi: number; human: number; unattributed: number }

const isAi = (model: string): boolean => providerOf(model) !== 'unknown';

/** Line-weighted descriptive breakdown of churned lines by rewriter relationship to the
 *  authored producer. Exact counting (deterministic). The producer is joined at query time. */
export function rewriterBreakdown(events: DomainEventEnvelope[], repo: string): ReworkBreakdown {
  const prod = producerByPr(events, repo);
  const b: ReworkBreakdown = { self: 0, crossAi: 0, human: 0, unattributed: 0, totalChurned: 0 };
  for (const [pr, p] of churnByPr(events, repo)) {
    const mine = prod.get(pr);
    const myKey = mine ? actorKey(mine) : undefined;
    for (const r of p.rewrittenByLines) {
      b.totalChurned += r.lines;
      const rp = prod.get(r.pr);
      if (!myKey || !rp) { b.unattributed += r.lines; continue; }     // can't compare → unattributed
      if (actorKey(rp) === myKey) b.self += r.lines;
      else if (rp.producer === 'human') b.human += r.lines;
      else if (isAi(rp.model) && isAi(mine!.model)) b.crossAi += r.lines;
      else b.unattributed += r.lines;
    }
  }
  return b;
}

const shares = (b: ReworkBreakdown): ReworkShares => {
  const t = b.totalChurned || 1;
  return { self: b.self / t, crossAi: b.crossAi / t, human: b.human / t, unattributed: b.unattributed / t };
};

export interface AiRework { repo: string; breakdown: ReworkBreakdown; shares: ReworkShares; authoredGap: WhatIf; byModel: WhatIf; warnings: string[] }

export function aiRework(events: DomainEventEnvelope[], opts: { repo: string }): AiRework {
  const { repo } = opts;
  const breakdown = rewriterBreakdown(events, repo);
  const authoredGap = whatIf(events, { repo, indicator: 'short-term-churn', by: 'ai-vs-human' });
  const byModel = whatIf(events, { repo, indicator: 'short-term-churn', by: 'model' });
  const warnings = [...new Set([...authoredGap.warnings])];
  if (!authoredGap.strata.some((s) => s.value === 'human'))
    warnings.unshift('authored-side AI-vs-human gap is INCONCLUSIVE — no identifiable human arm (agent PRs ship under a human GitHub login; only ProducerAttributed marks AI).');
  return { repo, breakdown, shares: shares(breakdown), authoredGap, byModel, warnings };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** Pure readout (lines) for an AiRework result — the CLI prints these verbatim. */
export function renderAiRework(ar: AiRework): string[] {
  const b = ar.breakdown, s = ar.shares;
  const out = [
    `AI REWORK — ${ar.repo}   (producer-attributed churn — TREND, never a gate)`,
    '',
    '   Rewriter-side (who rewrote the churned lines, line-weighted):',
    `      self          ${pct(s.self).padStart(7)}  (${b.self} lines)   ← the AI value leak (a producer rewriting its own recent output)`,
    `      cross-ai      ${pct(s.crossAi).padStart(7)}  (${b.crossAi} lines)`,
    `      human         ${pct(s.human).padStart(7)}  (${b.human} lines)`,
    `      unattributed  ${pct(s.unattributed).padStart(7)}  (${b.unattributed} lines)`,
    `      total churned ${String(b.totalChurned).padStart(6)} lines`,
    '',
    '   Authored-side (does AI-authored code churn more than human?):',
    ...ar.authoredGap.strata.map((st) => `      ${st.value.padEnd(8)} ${String(st.n).padStart(3)} PRs   ${pct(st.point).padStart(7)}  [${pct(st.p10)} .. ${pct(st.p90)}]`),
    '   AI-internal by model (the substantive content under monoculture):',
    ...ar.byModel.strata.map((st) => `      ${st.value.padEnd(20)} ${String(st.n).padStart(3)} PRs   ${pct(st.point).padStart(7)}  [${pct(st.p10)} .. ${pct(st.p90)}]`),
    '',
    ...ar.warnings.map((w) => `   ⚠ ${w}`),
    '',
    '   TREND/WARN — never a gate. Observational ≠ causal (a decision aid). Goodhart: score self-churn,',
    "   don't chase it — a small self share can be an attribution artifact when rewriters are largely unattributed.",
  ];
  return out;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/ai-rework.test.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inference/ai-rework.ts test/ai-rework.test.ts
git commit -m "feat(devloop): ai-rework composed readout — authored gap + rewriter breakdown (S3)"
```

---

### Task 8: CLI wiring — `ai-rework <repo>`

**Files:**
- Modify: `src/cli.ts` (import; `showAiRework`; `case 'ai-rework'`; header comment + the `whatif` usage string)
- Test: `test/ai-rework-cli.test.ts` (mirror `test/net-flow-cli.test.ts`)

**Interfaces:**
- Consumes: `aiRework`, `renderAiRework` (Task 7).
- Produces: CLI command `ai-rework <owner/repo>`.

- [ ] **Step 1: Write the failing test** — first read `test/net-flow-cli.test.ts` to mirror its harness exactly, then create `test/ai-rework-cli.test.ts` asserting that running the `ai-rework` command on a synthesized log prints the `AI REWORK — <repo>` header and the `self` line, and that a missing repo prints the usage string. (Use the same child-process / log-fixture mechanism `net-flow-cli.test.ts` uses — do not invent a new one.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/ai-rework-cli.test.ts` → FAIL (`ai-rework` command unknown).

- [ ] **Step 3: Implement** — in `src/cli.ts`:
  1. Add import: `import { aiRework, renderAiRework } from './inference/ai-rework.js';`.
  2. Add the handler (near `showNetFlow`):

```ts
function showAiRework(repo: string): void {
  if (!repo) { console.log('usage: ai-rework <owner/repo>'); return; }
  console.log(renderAiRework(aiRework(readEnvelopes(), { repo })).join('\n'));
}
```

  3. Add the dispatch case (near `case 'net-flow'`): `case 'ai-rework': showAiRework(rest[0] ?? ''); break;`.
  4. Update the header usage comment block + the `whatif` usage string to add `self-churn` (indicator) and `ai-vs-human` (lever) and a `devloop ai-rework <repo>` line.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/ai-rework-cli.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/ai-rework-cli.test.ts
git commit -m "feat(devloop): ai-rework CLI command + usage (S3)"
```

---

### Task 9: Full gate + first real reading

**Files:** none (verification only).

- [ ] **Step 1: Full local gate** — `npm run typecheck && npm run test && npx knip`. Expected: typecheck clean, all tests pass, knip reports no NEW unused exports (un-export any in-file-only helper knip flags — e.g. confirm `ReworkShares`/`shares` usage; `rewriterBreakdown`/`aiRework`/`renderAiRework` are consumed by the CLI + tests).
- [ ] **Step 2: Populate the enriched field + first reading** — `npm run dev -- churn de-braighter/devloop` (re-emits ChurnObserved with `rewrittenByLines`), then `npm run dev -- ai-rework de-braighter/devloop`. Capture the readout (self / cross-ai / unattributed shares + the INCONCLUSIVE authored gap) for the PR description. Confirm `churnByPr` collapsed the old+new ChurnObserved (no double-count: `totalChurned` is plausible, not ~2×).
- [ ] **Step 3: self-churn declarability smoke** — `npm run dev -- reconcile` after a `declare-effect '{"repo":"de-braighter/devloop","pr":<a-closed-PR>,"indicatorId":"self-churn","predicted":0.05,"sd":0.02}'` to confirm it observes (or defers with a clear reason), not "unobservable".

---

## Self-Review (author checklist — completed)

- **Spec coverage:** §3.1 enrich event → T1; §3.1 ingester → T2; §3.2 churnByPr → T3; §3.3 self-churn indicator+observer → T4+T6; §3.4 ai-vs-human lever → T5; §3.5 composed readout+CLI → T7+T8; honesty acids (§4/§5) distributed across T4 (unattributed-not-self), T5 (monoculture), T7 (breakdown shares + gap inconclusive), T1 (Σ invariant), T3 (collapse). CFR-out / no-gate are inherent (nothing built).
- **Placeholder scan:** the only "read the neighbour first" is T8's CLI-test harness (deliberate — `net-flow-cli.test.ts` is the canonical fixture mechanism and must be mirrored, not reinvented). All code steps carry real code.
- **Type consistency:** `rewrittenByLines: {pr,lines}[]` consistent across events/ingester/readers; `actorKey`, `churnByPr`, `producerByPr` signatures match across T3→T4→T6→T7; `ReworkBreakdown` keys (`self/crossAi/human/unattributed/totalChurned`) consistent T7 impl ↔ test.

## Post-build (orchestrator, not a worker task)

Open the devloop PR **before** the verifier wave (S1/S2 lesson). Verifier wave (charter-checker + reviewer + qa-engineer) + opus WHOLE-BRANCH capstone — run devloop-branch agents **WITHOUT** `isolation: "worktree"` (it worktrees the empty workbench clone); read-only agents do NO git ops in the shared clone. Consolidate ALL wave+capstone findings into ONE fix subagent. PR-per-repo (devloop code + specs ADR-271), `Producer:`/`Effort:`/`Effect:` lines. Declare only genuinely self-observing Effects; the wave-as-subagents `findings` gap persists (declare `findings` only if the wave routes through foundry verdict-capture). **WAIT for founder "go" to merge** (founder-gated). Twin ritual after each merge; reconcile ADR-271 to FINAL code at ratify.
