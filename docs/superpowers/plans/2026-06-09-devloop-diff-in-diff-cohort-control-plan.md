# Diff-in-Diff Cohort Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a difference-in-differences cohort control to the cross-repo adoption study, isolating the maturation confound by comparing adopters' net-effect to comparable non-adopters' net-effect over the same period.

**Architecture:** Two small pure additions to `src/intel/adoption-study.ts` (`assignPseudoEvents`, `diffInDiff`), a render extension, and CLI glue that ingests the non-adopters (already detected in the same scan) with deterministic pseudo-events, runs the *same* `studyRepo` on them, and reports the diff-in-diff. Reuses `ingestWindowed`/`studyRepo`/`prOutcomes` unchanged.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), vitest. Tests in `test/`.

**Working directory:** `D:/development/projects/de-braighter/domains/devloop`. **Before Task 1, branch off `main`** (which has the merged study #60/#61):

```bash
cd D:/development/projects/de-braighter/domains/devloop
git checkout main && git pull --ff-only
git checkout -b feat/intel-diff-in-diff
```

**Spec:** `docs/superpowers/specs/2026-06-09-devloop-diff-in-diff-cohort-control-design.md`. **Governance:** public-repo data only; the real run is a human step.

---

## File Structure

- `src/intel/adoption-study.ts` — **modify** (Task 1): add `assignPseudoEvents` + `diffInDiff` + `DiffInDiff` type. Reuses the existing `median`, `OUTCOMES`, `OutcomeKey`, `RepoStudy`.
- `src/intel/render-study.ts` — **modify** (Task 2): optional `dd` param → a diff-in-diff section + the parallel-trends caveat.
- `src/cli.ts` (`intel-study` case) — **modify** (Task 3): collect non-adopters → `assignPseudoEvents` → `ingestWindowed` → control `studyRepo`s → `diffInDiff` → render. Coverage-excluded glue.
- `test/adoption-study.test.ts`, `test/render-study.test.ts` — **extend** (Tasks 1–2).

---

## Task 1: `assignPseudoEvents` + `diffInDiff` (the credibility core)

**Files:** Modify `src/intel/adoption-study.ts`; extend `test/adoption-study.test.ts`.

- [ ] **Step 1: Write the failing tests** — append to `test/adoption-study.test.ts` (the file already imports `studyRepo`, `poolStudies`, `RepoStudy`; add `assignPseudoEvents`, `diffInDiff` to that import, and import the `DiffInDiff` type):

```typescript
import { assignPseudoEvents, diffInDiff, type DiffInDiff } from '../src/intel/adoption-study.js';

describe('assignPseudoEvents', () => {
  it('assigns sorted adopter dates to non-adopters by i mod N (deterministic)', () => {
    const r = assignPseudoEvents([300, 100, 200], ['a', 'b', 'c', 'd']); // sorted: 100,200,300
    expect(r.map((x) => x.pseudoEventMs)).toEqual([100, 200, 300, 100]);
    expect(r.map((x) => x.repo)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('returns empty when there are no adopter dates', () => {
    expect(assignPseudoEvents([], ['a'])).toEqual([]);
  });
});

describe('diffInDiff', () => {
  const mk = (repo: string, net: number): RepoStudy => ({
    repo, qualified: true,
    effects: [{ outcome: 'cycleHours', before: 0, after: 0, placeboPre: 0, effect: 0, placebo: 0, netEffect: net }],
  });
  it('computes treatmentMedian − controlMedian per outcome', () => {
    const treatment = [mk('t1', -2), mk('t2', 4)]; // median 1
    const control = [mk('c1', 1), mk('c2', 3)]; // median 2
    const d = diffInDiff(treatment, control).find((x) => x.outcome === 'cycleHours')!;
    expect(d.treatmentMedian).toBe(1);
    expect(d.controlMedian).toBe(2);
    expect(d.diffInDiff).toBe(-1);
    expect(d.nTreat).toBe(2);
    expect(d.nControl).toBe(2);
  });
  it('reports treatment but NaN diff-in-diff when there is no qualifying control', () => {
    const d = diffInDiff([mk('t', -2)], []).find((x) => x.outcome === 'cycleHours')!;
    expect(d.treatmentMedian).toBe(-2);
    expect(d.nControl).toBe(0);
    expect(Number.isNaN(d.controlMedian)).toBe(true);
    expect(Number.isNaN(d.diffInDiff)).toBe(true);
  });
  it('excludes unqualified studies from both arms', () => {
    const treatment: RepoStudy[] = [mk('t1', -2), { repo: 't2', qualified: false, reason: 'thin', effects: [] }];
    const d = diffInDiff(treatment, []).find((x) => x.outcome === 'cycleHours')!;
    expect(d.nTreat).toBe(1); // only the qualified one
  });
});
```

- [ ] **Step 2: Run — verify it fails**: `npx vitest run test/adoption-study.test.ts` → FAIL (`assignPseudoEvents`/`diffInDiff` not exported).

- [ ] **Step 3: Implement** — append to `src/intel/adoption-study.ts` (after `poolStudies`):

```typescript
// --- diff-in-diff cohort control: isolate the maturation confound the within-repo placebo
// can't (teams adopt templates as they formalise/scale — a coincident regime change). Compare
// adopters' net-effect to comparable non-adopters' net-effect over the same period. ---

/** Deterministic, calendar-aligned pseudo-event dates for control (non-adopter) repos:
 *  non-adopter i gets the i-th adopter date (sorted ascending), cycling. Reproducible (no RNG). */
export function assignPseudoEvents(
  adopterDatesMs: number[],
  nonAdopters: string[],
): Array<{ repo: string; pseudoEventMs: number }> {
  const sorted = [...adopterDatesMs].sort((a, b) => a - b);
  if (!sorted.length) return [];
  return nonAdopters.map((repo, i) => ({ repo, pseudoEventMs: sorted[i % sorted.length]! }));
}

export interface DiffInDiff {
  outcome: OutcomeKey;
  treatmentMedian: number;
  controlMedian: number; // NaN when no qualifying control for this outcome
  diffInDiff: number; // treatmentMedian − controlMedian (NaN when no control)
  nTreat: number;
  nControl: number;
}

function netEffectsOf(studies: RepoStudy[], outcome: OutcomeKey): number[] {
  return studies
    .filter((s) => s.qualified)
    .flatMap((s) => s.effects.filter((e) => e.outcome === outcome).map((e) => e.netEffect));
}

/** Per outcome, difference-in-differences = treatment (adopter) median net-effect minus
 *  control (non-adopter) median net-effect — the template effect net of cohort drift. */
export function diffInDiff(treatment: RepoStudy[], control: RepoStudy[]): DiffInDiff[] {
  const out: DiffInDiff[] = [];
  for (const outcome of OUTCOMES) {
    const t = netEffectsOf(treatment, outcome);
    if (!t.length) continue;
    const c = netEffectsOf(control, outcome);
    const tMed = median(t);
    const cMed = c.length ? median(c) : NaN;
    out.push({
      outcome,
      treatmentMedian: tMed,
      controlMedian: cMed,
      diffInDiff: c.length ? tMed - cMed : NaN,
      nTreat: t.length,
      nControl: c.length,
    });
  }
  return out;
}
```

(Note: the spec listed per-arm p10/p90 on `DiffInDiff`; trimmed here per YAGNI — the renderer needs only the medians + diff + counts, and treatment spread is already in the `pooled` section.)

- [ ] **Step 4: Run — verify it passes**: `npx vitest run test/adoption-study.test.ts` → PASS.

- [ ] **Step 5: Full suite**: `npx vitest run` → green.

- [ ] **Step 6: Commit**:

```bash
git add src/intel/adoption-study.ts test/adoption-study.test.ts
git commit -m "feat(intel): diff-in-diff cohort control + deterministic pseudo-events

assignPseudoEvents (calendar-aligned, reproducible) + diffInDiff (treatment − control median
net-effect per outcome) — isolates the maturation confound the within-repo placebo can't."
```

---

## Task 2: Render the diff-in-diff section

**Files:** Modify `src/intel/render-study.ts`; extend `test/render-study.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `test/render-study.test.ts` (add `type DiffInDiff` to the existing `adoption-study` import):

```typescript
import type { DiffInDiff } from '../src/intel/adoption-study.js';

describe('renderStudyMarkdown — diff-in-diff section', () => {
  const pooled = [{ outcome: 'cycleHours' as const, n: 35, medianNetEffect: 2.8, p10: -5, p90: 4, pctImproved: 0.37 }];
  const funnel = { practice: 'PR template', language: 'TypeScript', scanned: 200, withEvent: 126, qualified: 35 };

  it('renders the diff-in-diff section + parallel-trends caveat when control data is present', () => {
    const dd: DiffInDiff[] = [{ outcome: 'cycleHours', treatmentMedian: 2.8, controlMedian: 2.0, diffInDiff: 0.8, nTreat: 35, nControl: 30 }];
    const md = renderStudyMarkdown(pooled, funnel, dd);
    expect(md).toContain('difference-in-differences');
    expect(md).toContain('baseline drift');
    expect(md).toContain('nControl=30');
    expect(md).toMatch(/parallel trends/i);
  });

  it('omits the diff-in-diff section (and its caveat) when no control data', () => {
    const md = renderStudyMarkdown(pooled, funnel);
    expect(md).not.toContain('difference-in-differences');
    expect(md).not.toMatch(/parallel trends/i);
  });
});
```

- [ ] **Step 2: Run — verify it fails**: `npx vitest run test/render-study.test.ts` → FAIL (3rd arg not used / section absent).

- [ ] **Step 3: Implement** — in `src/intel/render-study.ts`:

(a) Extend the imports. Change:
```typescript
import type { PooledOutcome, OutcomeKey } from './adoption-study.js';
```
to:
```typescript
import type { PooledOutcome, OutcomeKey, DiffInDiff } from './adoption-study.js';
```

(b) Add the optional `dd` parameter. Change the signature:
```typescript
export function renderStudyMarkdown(pooled: PooledOutcome[], funnel: StudyFunnel): string {
```
to:
```typescript
export function renderStudyMarkdown(pooled: PooledOutcome[], funnel: StudyFunnel, dd: DiffInDiff[] = []): string {
```

(c) Insert the diff-in-diff section immediately BEFORE the closing `---` footer. Find:
```typescript
  lines.push('');
  lines.push('---');
  lines.push(
    '_Observational, placebo-controlled — **not a randomized trial**. Count-based windows; ' +
      'open-source cohort (may not generalize to private/enterprise teams); repos that adopt a template may differ systematically._',
  );
  lines.push('');
  return lines.join('\n');
```
and replace with:
```typescript
  lines.push('');
  if (dd.length > 0) {
    lines.push('## Net of cohort drift (difference-in-differences)');
    lines.push('');
    lines.push('Versus comparable non-adopting repos measured over the same period — the template effect beyond ecosystem/maturation drift:');
    lines.push('');
    for (const d of dd) {
      const ddText = Number.isNaN(d.diffInDiff) ? 'n/a (no qualifying control)' : signedHours(d.diffInDiff);
      const ctrlText = Number.isNaN(d.controlMedian) ? 'n/a' : `${signedHours(d.controlMedian)} (baseline drift)`;
      lines.push(
        `- **${LABEL[d.outcome]}:** adopters ${signedHours(d.treatmentMedian)}, comparable non-adopters ${ctrlText} → ` +
          `**diff-in-diff: ${ddText}** (nTreat=${d.nTreat}, nControl=${d.nControl}).`,
      );
    }
    lines.push('');
  }
  lines.push('---');
  const ddCaveat = dd.length > 0
    ? ' Difference-in-differences assumes adopters and comparable non-adopters would have drifted the same absent adoption (parallel trends) — not testable, but stronger than the within-repo control alone.'
    : '';
  lines.push(
    '_Observational, placebo-controlled — **not a randomized trial**. Count-based windows; ' +
      `open-source cohort (may not generalize to private/enterprise teams); repos that adopt a template may differ systematically.${ddCaveat}_`,
  );
  lines.push('');
  return lines.join('\n');
```

- [ ] **Step 4: Run — verify it passes**: `npx vitest run test/render-study.test.ts` → PASS (existing + 2 new).

- [ ] **Step 5: Full suite**: `npx vitest run` → green.

- [ ] **Step 6: Commit**:

```bash
git add src/intel/render-study.ts test/render-study.test.ts
git commit -m "feat(intel): render the diff-in-diff section + parallel-trends caveat

Shows adopters vs comparable non-adopters (baseline drift) vs the net diff-in-diff per
outcome; degrades cleanly when no control data."
```

---

## Task 3: CLI — control cohort + diff-in-diff (glue)

`cli.ts` is coverage-excluded; verified by typecheck + the unit suite. No data run.

**Files:** Modify `src/cli.ts` (`intel-study` case).

- [ ] **Step 1: Extend the adoption-study import.** Find:
```typescript
import { studyRepo, poolStudies, type RepoStudy } from './intel/adoption-study.js';
```
Replace with:
```typescript
import { studyRepo, poolStudies, assignPseudoEvents, diffInDiff, type RepoStudy } from './intel/adoption-study.js';
```

- [ ] **Step 2: Collect non-adopters in the scan loop.** In the `intel-study` case, find the start of the loop:
```typescript
    const adopted = new Map<string, number>();
    let withEvent = 0;
    let skipped = 0;
    let scanned = 0;
    for (const repo of repos) {
      scanned++;
      // Per-repo work is wrapped so a transient gh/network error (e.g. a TLS handshake
      // timeout over a long scan) skips that one repo rather than aborting the whole run.
      try {
        const at = detectAdoption(repo);
        if (!at) continue;
        const adoptedAtMs = Date.parse(at);
```
and replace with (add `nonAdopters` + collect on the no-event path):
```typescript
    const adopted = new Map<string, number>();
    const nonAdopters: string[] = [];
    let withEvent = 0;
    let skipped = 0;
    let scanned = 0;
    for (const repo of repos) {
      scanned++;
      // Per-repo work is wrapped so a transient gh/network error (e.g. a TLS handshake
      // timeout over a long scan) skips that one repo rather than aborting the whole run.
      try {
        const at = detectAdoption(repo);
        if (!at) {
          nonAdopters.push(repo);
          continue;
        }
        const adoptedAtMs = Date.parse(at);
```

- [ ] **Step 3: Add the control cohort + diff-in-diff after the loop.** Find:
```typescript
    const events = readEnvelopes();
    const studies: RepoStudy[] = [...adopted.entries()].map(([repo, adoptedAtMs]) =>
      studyRepo({ repo, outcomes: prOutcomes(events, repo), adoptedAtMs }),
    );
    const pooled = poolStudies(studies);
    const funnel = { practice: 'PR template', language, scanned: repos.length, withEvent, qualified: studies.filter((s) => s.qualified).length };
    const out = join(DATA_DIR, `intel-study-pr-template-${language}.md`);
    writeFileSync(out, renderStudyMarkdown(pooled, funnel));
    console.log(`wrote ${out} — ${funnel.qualified}/${withEvent} repos qualified (${skipped} skipped on transient errors)`);
```
and replace with:
```typescript
    // Control cohort: ingest the non-adopters at deterministic, calendar-aligned pseudo-events
    // (capped at the adopter count) so a difference-in-differences can net out cohort drift.
    const pseudo = assignPseudoEvents([...adopted.values()], nonAdopters.slice(0, adopted.size));
    for (const { repo, pseudoEventMs } of pseudo) {
      try {
        ingestWindowed(repo, pseudoEventMs);
      } catch (err) {
        skipped++;
        console.error(`  skipped control ${repo}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      }
    }
    const events = readEnvelopes();
    const studies: RepoStudy[] = [...adopted.entries()].map(([repo, adoptedAtMs]) =>
      studyRepo({ repo, outcomes: prOutcomes(events, repo), adoptedAtMs }),
    );
    const controlStudies: RepoStudy[] = pseudo.map(({ repo, pseudoEventMs }) =>
      studyRepo({ repo, outcomes: prOutcomes(events, repo), adoptedAtMs: pseudoEventMs }),
    );
    const pooled = poolStudies(studies);
    const dd = diffInDiff(studies, controlStudies);
    const funnel = { practice: 'PR template', language, scanned: repos.length, withEvent, qualified: studies.filter((s) => s.qualified).length };
    const out = join(DATA_DIR, `intel-study-pr-template-${language}.md`);
    writeFileSync(out, renderStudyMarkdown(pooled, funnel, dd));
    const nControl = controlStudies.filter((s) => s.qualified).length;
    console.log(`wrote ${out} — ${funnel.qualified}/${withEvent} qualified; control n=${nControl} (${skipped} skipped)`);
```

- [ ] **Step 4: Verify (typecheck + unit suite ONLY — no data run):**
```bash
npx tsc -p tsconfig.json --noEmit
npx vitest run
```
Expected: typecheck clean; suite all green. Do NOT run `intel-study` against real repos here — the human runs that.

- [ ] **Step 5: Commit:**
```bash
git add src/cli.ts
git commit -m "feat(cli): intel-study control cohort + diff-in-diff

Collects non-adopters, ingests them at deterministic pseudo-events, runs the same studyRepo,
and reports the diff-in-diff net of cohort drift. Coverage-excluded glue."
```

---

## Final verification + the sharpened run

- [ ] `npx vitest run && npx tsc -p tsconfig.json --noEmit` → green/clean.
- [ ] PR in `domains/devloop`. Body lines:
```
Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Effect: cycle-time 0.3±0.4 expert
```
- [ ] **The sharpened run (human/controller, public data):**
```bash
DEVLOOP_LOG=data/intel-pr-template-ts.jsonl npx tsx src/cli.ts intel-study typescript 200
```
→ the finding now reports adopters vs comparable non-adopters vs the **diff-in-diff** (template effect net of cohort drift).

---

## Self-Review

**1. Spec coverage:** §1 method → Task 1 (`diffInDiff`) + Task 3 (wires treatment+control studies). §2 pseudo-event → Task 1 (`assignPseudoEvents`, deterministic `i mod N` over sorted dates) + Task 3 (applied to non-adopters, capped). §3 changes → Tasks 1–3 (ingest non-adopters, run studyRepo, diffInDiff, render). §5 output → Task 2 (render section). §6 caveat → Task 2 (parallel-trends footer). §8 testing → Tasks 1–2 tests incl. empty-control degenerate cases. Reuses `ingestWindowed`/`studyRepo`/`prOutcomes` unchanged per §3/§7.

**2. Placeholder scan:** No TBD/TODO; every step has complete code. (The trimmed `DiffInDiff` vs the spec's percentile listing is called out explicitly as a YAGNI deviation, not a gap.)

**3. Type consistency:** `DiffInDiff` (Task 1) is consumed by `render-study.ts` (Task 2) + cli (Task 3) with matching fields (`outcome`, `treatmentMedian`, `controlMedian`, `diffInDiff`, `nTreat`, `nControl`). `assignPseudoEvents` returns `{repo, pseudoEventMs}[]` consumed identically in Task 3. `RepoStudy`/`OutcomeKey`/`median`/`OUTCOMES` reused from the existing module. `studyRepo({repo, outcomes, adoptedAtMs})` (the control call passes `adoptedAtMs: pseudoEventMs`) matches `RepoStudyInput`. No MC — deterministic tests.
