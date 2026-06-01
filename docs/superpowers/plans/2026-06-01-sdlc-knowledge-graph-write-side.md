# SDLC Knowledge Graph (write-side emit-loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project devloop's append-only event log into the knowledge graph as a *local overlay* so `kg_context` answers "what did we recently decide/ship and learn that bears on this task?" — not just what the specs say.

**Architecture:** A new `activity-reader` turns events into `pr` (provenance, low rank) and `lesson` (knowledge, high rank) nodes; `mergeActivityOverlay` fuses them onto the served graph exactly like the existing memory overlay (re-deriving `mentions` against the merged set). A single new `Lesson:` PR-body convention (parsed in `backfill` like `Effect:`/`Producer:`) is the only new write path. Open-loops/heat/freshness are rendered at pack-time. No kernel change; the S3 base, image, and CronJob are untouched.

**Tech Stack:** TypeScript (ESM, explicit `.js` import specifiers), `noUncheckedIndexedAccess`, Vitest (tests under `test/knowledge-graph/`), zod-validated `DomainEventEnvelope`s from `@de-braighter/substrate-contracts`.

**Spec:** `docs/superpowers/specs/2026-06-01-sdlc-knowledge-graph-write-side-design.md`

**Working directory for all `npm`/`git` commands:** `domains/devloop` (the devloop repo). Run from there unless a path says otherwise.

---

## File Structure

**Create:**
- `src/knowledge-graph/sources/activity-reader.ts` — `eventsToActivity(events, windowDays, now)` (pure) + `readActivity(logPath, windowDays, now)` (file wrapper). Emits `pr` + `lesson` nodes and `evidenced-by` / `applies-to-area` edges.
- `src/knowledge-graph/retrieval/activity-pack.ts` — `renderActivitySections(graph, relevantIds, now)` → the LEARNED / OPEN LOOPS / FRESH text appended to the context pack.
- `test/knowledge-graph/lesson-parse.test.ts`
- `test/knowledge-graph/activity-reader.test.ts`
- `test/knowledge-graph/activity-overlay.test.ts`
- `test/knowledge-graph/activity-pack.test.ts`

**Modify:**
- `src/knowledge-graph/graph-model.ts` — add `pr`/`lesson` to `NodeKind`, `evidenced-by` to `EdgeType`, `open`/`merged` to `NodeStatus` + `STATUS_WEIGHT`.
- `src/ingest/github.ts` — add `LESSON_RE` + `parseLessons()`; wire into `backfill()`.
- `src/knowledge-graph/config.ts` — add `logPath` + `activityWindowDays` to `KgConfig`/`resolveConfig`.
- `src/knowledge-graph/index.ts` — add + export `mergeActivityOverlay()`; chain it in `loadServingIndex()`.
- `src/knowledge-graph/retrieval/rank.ts` — multiply the composite score by a per-`kind` weight (lesson > corpus > pr).
- `src/knowledge-graph/retrieval/context-pack.ts` — append `renderActivitySections(...)` to the emitted pack.

---

## Pre-flight

- [ ] **Step 0: Confirm a green baseline**

Run: `npm run ci:local`
Expected: PASS (devloop `main` is Sonar-green and tests pass; if this fails, stop and fix the environment before starting — do not build on a red baseline).

---

## Task 1: Graph-model additions

**Files:**
- Modify: `src/knowledge-graph/graph-model.ts`
- Test: `test/knowledge-graph/graph-model-activity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/graph-model-activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { STATUS_WEIGHT } from '../../src/knowledge-graph/graph-model.js';
import type { NodeKind, EdgeType, NodeStatus } from '../../src/knowledge-graph/graph-model.js';

describe('graph-model activity additions', () => {
  it('ranks open loops high and merged PRs neutral', () => {
    expect(STATUS_WEIGHT.open).toBeGreaterThan(STATUS_WEIGHT.proposed);
    expect(STATUS_WEIGHT.merged).toBeGreaterThan(STATUS_WEIGHT.superseded);
    expect(STATUS_WEIGHT.merged).toBeLessThan(STATUS_WEIGHT.open);
  });

  it('admits the activity vocabulary in the unions (compile-time)', () => {
    const k: NodeKind[] = ['pr', 'lesson'];
    const e: EdgeType = 'evidenced-by';
    const s: NodeStatus[] = ['open', 'merged'];
    expect(k).toContain('pr');
    expect(e).toBe('evidenced-by');
    expect(s).toContain('open');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/knowledge-graph/graph-model-activity.test.ts`
Expected: FAIL — `STATUS_WEIGHT.open` is `undefined`; TS errors on `'pr'`/`'lesson'`/`'evidenced-by'`/`'open'`/`'merged'` not assignable.

- [ ] **Step 3: Extend the unions and weights**

In `src/knowledge-graph/graph-model.ts`:

```ts
export type NodeKind = 'adr' | 'concept' | 'policy' | 'instruction' | 'memory' | 'pr' | 'lesson';
```

```ts
export type EdgeType =
  | 'relates-to'
  | 'depends-on'
  | 'supersedes'
  | 'superseded-by'
  | 'amends'
  | 'ratifies'
  | 'ratified-by'
  | 'implemented-by'
  | 'links-to'
  | 'mentions'
  | 'applies-to-area'
  | 'evidenced-by';
```

```ts
export type NodeStatus =
  | 'ratified'
  | 'accepted'
  | 'proposed'
  | 'draft'
  | 'superseded'
  | 'deprecated'
  | 'unknown'
  | 'open'
  | 'merged';
```

Add to the `STATUS_WEIGHT` record (keep existing entries):

```ts
export const STATUS_WEIGHT: Record<NodeStatus, number> = {
  ratified: 1,
  accepted: 0.9,
  proposed: 0.6,
  draft: 0.5,
  unknown: 0.5,
  superseded: 0.1,
  deprecated: 0.1,
  open: 1, // an outstanding loop is high-value to surface
  merged: 0.7, // a shipped PR: useful provenance, not a position
};
```

Leave `normalizeStatus()` unchanged — activity readers set `status` literally; `normalizeStatus` is only for frontmatter parsing.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/knowledge-graph/graph-model-activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge-graph/graph-model.ts test/knowledge-graph/graph-model-activity.test.ts
git commit -m "feat(kg): add activity vocabulary to the graph model (pr/lesson, evidenced-by, open/merged)"
```

---

## Task 2: The `Lesson:` PR-body parser

**Files:**
- Modify: `src/ingest/github.ts`
- Test: `test/knowledge-graph/lesson-parse.test.ts`

Context: mirrors the existing `parseEffectDeclarations` / `parseProducer` in the same file. A `RetroSignal` constructor `retro({ repo, pr, kind, note, by, ts })` already exists in `src/events.ts` (kind ∈ `friction|win|improvement`, `note` min length 1).

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/lesson-parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseLessons } from '../../src/ingest/github.js';
import { EVENT } from '../../src/events.js';

const TS = '2026-06-01T00:00:00Z';

describe('parseLessons', () => {
  it('parses an explicit-kind lesson line', () => {
    const body = 'Some PR description.\nLesson: friction — fixtures != real corpus; verify against real';
    const out = parseLessons(body, 'de-braighter/specs', 248, TS, 'orchestrator');
    expect(out).toHaveLength(1);
    expect(out[0]!.eventType).toBe(EVENT.RETRO);
    const p = out[0]!.payload as { kind: string; note: string; by?: string; repo: string; pr: number };
    expect(p.kind).toBe('friction');
    expect(p.note).toBe('fixtures != real corpus; verify against real');
    expect(p.by).toBe('orchestrator');
    expect(p.repo).toBe('de-braighter/specs');
    expect(p.pr).toBe(248);
  });

  it('defaults kind to friction when no kind/separator is given', () => {
    const out = parseLessons('Lesson: the cold-cache build break recurs', 'r', 1, TS, undefined);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload as { kind: string; note: string; by?: string };
    expect(p.kind).toBe('friction');
    expect(p.note).toBe('the cold-cache build break recurs');
    expect(p.by).toBe('session');
  });

  it('parses multiple lesson lines and all three kinds', () => {
    const body = [
      'Lesson: win — local overlay needs zero CronJob change',
      'Lesson: improvement — add distractor golden fixtures',
    ].join('\n');
    const out = parseLessons(body, 'r', 2, TS, undefined);
    expect(out.map((e) => (e.payload as { kind: string }).kind)).toEqual(['win', 'improvement']);
  });

  it('is left-anchored: a substring keyword cannot fabricate a lesson', () => {
    expect(parseLessons('Anti-Lesson: do not do this', 'r', 3, TS, undefined)).toHaveLength(0);
  });

  it('returns [] for empty/absent bodies', () => {
    expect(parseLessons(undefined, 'r', 4, TS, undefined)).toHaveLength(0);
    expect(parseLessons('', 'r', 4, TS, undefined)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/knowledge-graph/lesson-parse.test.ts`
Expected: FAIL — `parseLessons` is not exported.

- [ ] **Step 3: Add the parser to `src/ingest/github.ts`**

Add the `retro` import to the existing `events.js` import line so it reads:

```ts
import { prOpened, prMerged, verdict, producer, effectDeclared, retro } from '../events.js';
```

Add (after `parseProducer`, before `backfill`):

```ts
type RetroKind = 'friction' | 'win' | 'improvement';

// Lesson convention in a PR body (one or more lines):
//   Lesson: <kind> — <note>      (kind ∈ friction|win|improvement; default friction)
//   Lesson: <note>               (kind omitted → friction)
// Separator tolerant of —, -, :. Left-anchored (start-or-whitespace) so a substring
// like `Anti-Lesson:` cannot fabricate a RetroSignal into the append-only log —
// same hardening as PRODUCER_RE. The note runs to end-of-line (no `m` flag → `.`
// stops at the newline). To SET a kind you must use the separator; otherwise the
// whole remainder is the note and the kind defaults to friction.
const LESSON_RE = /(?:^|\s)Lesson:\s*(?:(friction|win|improvement)\s*[—:-]\s*)?(.+)/gi;

/** Parse `Lesson:` lines from a PR body into RetroSignal events. `by` is the
 *  capturing session/producer (resolve from the body's `Producer:` line in backfill). */
export function parseLessons(
  body: string | null | undefined,
  repo: string,
  pr: number,
  ts: string,
  by: string | undefined,
): DomainEventEnvelope[] {
  if (!body) return [];
  const out: DomainEventEnvelope[] = [];
  for (const m of body.matchAll(LESSON_RE)) {
    const note = m[2]?.trim();
    if (!note) continue;
    const kind = (m[1]?.toLowerCase() as RetroKind | undefined) ?? 'friction';
    out.push(retro({ repo, pr, kind, note, by: by ?? 'session', ts }));
  }
  return out;
}
```

- [ ] **Step 4: Run the parser test to confirm it passes**

Run: `npx vitest run test/knowledge-graph/lesson-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `parseLessons` into `backfill()`**

In `backfill()`, the loop already appends `prOpened`/`prMerged`, then effects, then producer. Replace the producer block with one that also captures the producer name and the lessons:

```ts
      // auto-capture producer attribution (`Producer:` convention) — the claimant for calibration
      const prod = parseProducer(p.body, repo, p.number, p.createdAt);
      let by: string | undefined;
      if (prod) {
        append(prod, logPath);
        n++;
        by = String((prod.payload as { producer?: string }).producer ?? '') || undefined;
      }
      // auto-capture lessons (`Lesson:` convention) — the redirect that keeps the
      // write-side knowledge in the PR body, not a hand-authored memory file
      for (const lesson of parseLessons(p.body, repo, p.number, p.createdAt, by)) {
        append(lesson, logPath);
        n++;
      }
```

- [ ] **Step 6: Run the full suite (no regressions in github ingest)**

Run: `npx vitest run test/`
Expected: PASS (existing github/backfill tests still green; new parser test green).

- [ ] **Step 7: Commit**

```bash
git add src/ingest/github.ts test/knowledge-graph/lesson-parse.test.ts
git commit -m "feat(kg): Lesson: PR-body convention -> RetroSignal (the write-side capture path)"
```

---

## Task 3: The activity reader (events → pr/lesson nodes)

**Files:**
- Create: `src/knowledge-graph/sources/activity-reader.ts`
- Test: `test/knowledge-graph/activity-reader.test.ts`

Context — confirmed helpers:
- `src/log.ts` exports `readEnvelopes(path?): DomainEventEnvelope[]`, `ofType(events, eventType): DomainEventEnvelope[]`, `DEFAULT_LOG: string`.
- `src/events.ts` exports `EVENT` and payload types `PrMergedPayload`, `ProducerPayload`, `VerdictPayload`, `RetroPayload`, `EffectDeclaredPayload`, `EffectObservedPayload`.
- We read `RetroSignal` events directly (not via `inference/retros.ts`) so this unit depends only on confirmed exports.

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/activity-reader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eventsToActivity } from '../../src/knowledge-graph/sources/activity-reader.js';
import { prOpened, prMerged, verdict, producer, retro, effectDeclared, effectObserved } from '../../src/events.js';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const recent = '2026-05-30T00:00:00Z'; // 2 days before NOW
const old = '2026-01-01T00:00:00Z'; // ~150 days before NOW

function byId<T extends { id: string }>(arr: T[], id: string): T {
  const hit = arr.find((x) => x.id === id);
  if (!hit) throw new Error(`no node ${id}`);
  return hit;
}

describe('eventsToActivity', () => {
  it('emits a merged pr node folding in verdict, producer, area', () => {
    const events = [
      prMerged({ repo: 'de-braighter/substrate', pr: 79, title: 'ADR-203 Normal-Normal fast path', cycleHours: 2.1, ts: recent }),
      verdict({ repo: 'de-braighter/substrate', pr: 79, verifier: 'reviewer', verdict: 'PASS', ts: recent }),
      producer({ repo: 'de-braighter/substrate', pr: 79, producer: 'orchestrator', model: 'claude-opus-4-8', ts: recent }),
    ];
    const slice = eventsToActivity(events, 60, NOW);
    const node = byId(slice.nodes, 'de-braighter/substrate#79');
    expect(node.kind).toBe('pr');
    expect(node.status).toBe('merged');
    expect(node.summary).toContain('ADR-203');
    expect(node.summary.toLowerCase()).toContain('orchestrator');
    expect(node.date).toBe(recent);
    expect(slice.edges).toContainEqual({ from: node.id, to: 'area:substrate', type: 'applies-to-area' });
  });

  it('flags a declared-but-unobserved effect on the pr summary', () => {
    const events = [
      prMerged({ repo: 'r', pr: 1, title: 't', cycleHours: 1, ts: recent }),
      effectDeclared({ repo: 'r', pr: 1, indicatorId: 'coverage', predicted: 4, sd: 2, ts: recent }),
    ];
    const node = byId(eventsToActivity(events, 60, NOW).nodes, 'r#1');
    expect(node.summary.toLowerCase()).toContain('coverage');
    expect(node.summary).toMatch(/unobserved|not yet observed/i);
  });

  it('does NOT flag an effect that has a matching observation', () => {
    const events = [
      prMerged({ repo: 'r', pr: 2, title: 't', cycleHours: 1, ts: recent }),
      effectDeclared({ repo: 'r', pr: 2, indicatorId: 'coverage', predicted: 4, sd: 2, ts: recent }),
      effectObserved({ repo: 'r', pr: 2, indicatorId: 'coverage', observed: 5, ts: recent }),
    ];
    const node = byId(eventsToActivity(events, 60, NOW).nodes, 'r#2');
    expect(node.summary).not.toMatch(/unobserved|not yet observed/i);
  });

  it('emits a lesson node with evidenced-by + open status for unapplied improvements', () => {
    const events = [
      prMerged({ repo: 'de-braighter/devloop', pr: 33, title: 'kg read-side', cycleHours: 1, ts: recent }),
      retro({ repo: 'de-braighter/devloop', pr: 33, kind: 'improvement', note: 'add distractor golden fixtures', ts: recent }),
      retro({ repo: 'de-braighter/devloop', pr: 33, kind: 'friction', note: 'fixtures != real corpus', ts: recent }),
    ];
    const slice = eventsToActivity(events, 60, NOW);
    const improvement = byId(slice.nodes, 'lesson:de-braighter/devloop#33#0');
    const friction = byId(slice.nodes, 'lesson:de-braighter/devloop#33#1');
    expect(improvement.kind).toBe('lesson');
    expect(improvement.status).toBe('open'); // unapplied improvement
    expect(friction.status).toBe('unknown');
    expect(slice.edges).toContainEqual({ from: improvement.id, to: 'de-braighter/devloop#33', type: 'evidenced-by' });
    expect(slice.edges).toContainEqual({ from: improvement.id, to: 'area:devloop', type: 'applies-to-area' });
  });

  it('an applied improvement (appliedRef) is not open', () => {
    const events = [
      retro({ repo: 'r', pr: 9, kind: 'improvement', note: 'done thing', appliedRef: 'r#10', ts: recent }),
    ];
    const node = byId(eventsToActivity(events, 60, NOW).nodes, 'lesson:r#9#0');
    expect(node.status).toBe('unknown');
  });

  it('windows out old PRs but keeps open improvements regardless of age', () => {
    const events = [
      prMerged({ repo: 'r', pr: 100, title: 'ancient', cycleHours: 1, ts: old }),
      retro({ repo: 'r', pr: 100, kind: 'improvement', note: 'still unapplied', ts: old }),
      retro({ repo: 'r', pr: 100, kind: 'friction', note: 'old friction', ts: old }),
    ];
    const ids = eventsToActivity(events, 60, NOW).nodes.map((n) => n.id);
    expect(ids).not.toContain('r#100'); // PR older than window: dropped
    expect(ids).toContain('lesson:r#100#0'); // open improvement: kept
    expect(ids).not.toContain('lesson:r#100#1'); // old non-open lesson: dropped
  });

  it('produces deterministic ids (idempotent re-read dedups via buildGraph)', () => {
    const events = [prMerged({ repo: 'r', pr: 5, title: 't', cycleHours: 1, ts: recent })];
    const a = eventsToActivity(events, 60, NOW).nodes.map((n) => n.id);
    const b = eventsToActivity(events, 60, NOW).nodes.map((n) => n.id);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/knowledge-graph/activity-reader.test.ts`
Expected: FAIL — module `activity-reader.js` not found / `eventsToActivity` not exported.

- [ ] **Step 3: Implement `src/knowledge-graph/sources/activity-reader.ts`**

```ts
import { existsSync } from 'node:fs';
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import type { KgNode, KgEdge, RawSlice } from '../graph-model.js';
import { readEnvelopes, ofType, DEFAULT_LOG } from '../../log.js';
import {
  EVENT,
  type PrMergedPayload,
  type ProducerPayload,
  type VerdictPayload,
  type RetroPayload,
  type EffectDeclaredPayload,
  type EffectObservedPayload,
} from '../../events.js';

// Repos that map directly to a known area. `de-braighter/specs` is intentionally
// absent — specs PRs link to the corpus through `mentions` (their title carries an
// `adr-NNN`), and that ADR carries its own `applies-to-area`.
const REPO_AREA: Record<string, string> = {
  'de-braighter/substrate': 'substrate',
  'de-braighter/design-system': 'design-system',
  'de-braighter/exercir': 'exercir',
  'de-braighter/conservation': 'conservation',
  'de-braighter/herdbook': 'herdbook',
  'de-braighter/devloop': 'devloop',
};

const DAY_MS = 86_400_000;
const prId = (repo: string, pr: number): string => `${repo}#${pr}`;

interface PrFacts {
  repo: string;
  pr: number;
  title: string;
  status: 'merged' | 'open';
  date: string; // ISO occurredAt of the merge (or open)
}

/** Latest merge (or, absent a merge, the open) per PR — within the window. */
function collectPrFacts(events: DomainEventEnvelope[], cutoffMs: number): Map<string, PrFacts> {
  const facts = new Map<string, PrFacts>();
  for (const e of ofType(events, EVENT.PR_MERGED)) {
    const p = e.payload as unknown as PrMergedPayload;
    if (Date.parse(e.occurredAt) < cutoffMs) continue;
    facts.set(prId(p.repo, p.pr), { repo: p.repo, pr: p.pr, title: p.title, status: 'merged', date: e.occurredAt });
  }
  for (const e of ofType(events, EVENT.PR_OPENED)) {
    const p = e.payload as unknown as { repo: string; pr: number; title: string };
    if (Date.parse(e.occurredAt) < cutoffMs) continue;
    const id = prId(p.repo, p.pr);
    if (!facts.has(id)) facts.set(id, { repo: p.repo, pr: p.pr, title: p.title, status: 'open', date: e.occurredAt });
  }
  return facts;
}

/** Per-PR annotations folded into the pr node summary (verdicts, producer, warnings). */
function prAnnotations(events: DomainEventEnvelope[], repo: string, pr: number): string {
  const parts: string[] = [];

  const verdicts = ofType(events, EVENT.VERDICT)
    .map((e) => e.payload as unknown as VerdictPayload)
    .filter((v) => v.repo === repo && v.pr === pr);
  if (verdicts.length) {
    const counts = verdicts.reduce<Record<string, number>>((a, v) => ({ ...a, [v.verdict]: (a[v.verdict] ?? 0) + 1 }), {});
    parts.push('wave: ' + Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', '));
  }

  const prod = ofType(events, EVENT.PRODUCER)
    .map((e) => e.payload as unknown as ProducerPayload)
    .find((p) => p.repo === repo && p.pr === pr);
  if (prod) parts.push(`by ${prod.producer}/${prod.model}`);

  // declared-but-unobserved effects = open loops, flagged on the provenance node
  const declared = ofType(events, EVENT.EFFECT_DECLARED)
    .map((e) => e.payload as unknown as EffectDeclaredPayload)
    .filter((d) => d.repo === repo && d.pr === pr);
  const observed = new Set(
    ofType(events, EVENT.EFFECT_OBSERVED)
      .map((e) => e.payload as unknown as EffectObservedPayload)
      .filter((o) => o.repo === repo && o.pr === pr)
      .map((o) => o.indicatorId),
  );
  for (const d of declared) {
    if (!observed.has(d.indicatorId)) parts.push(`⚠ effect '${d.indicatorId}' declared, not yet observed`);
  }

  // founder corrections / overrides = strong "watch out here" signal
  const corrected = ofType(events, EVENT.CORRECTION).some((e) => {
    const p = e.payload as { repo?: string; pr?: number };
    return p.repo === repo && p.pr === pr;
  });
  if (corrected) parts.push('⚠ founder correction recorded');
  const overridden = ofType(events, EVENT.OVERRIDE).some((e) => {
    const p = e.payload as { repo?: string; pr?: number };
    return p.repo === repo && p.pr === pr;
  });
  if (overridden) parts.push('⚠ verifier override recorded');

  return parts.join(' · ');
}

/** Pure: events -> activity slice (pr + lesson nodes, evidenced-by + applies-to-area edges). */
export function eventsToActivity(events: DomainEventEnvelope[], windowDays = 60, now = Date.now()): RawSlice {
  const cutoffMs = now - windowDays * DAY_MS;
  const nodes: KgNode[] = [];
  const edges: KgEdge[] = [];

  // ---- pr nodes (provenance) ----
  const facts = collectPrFacts(events, cutoffMs);
  for (const f of facts.values()) {
    const id = prId(f.repo, f.pr);
    const ann = prAnnotations(events, f.repo, f.pr);
    nodes.push({
      id,
      kind: 'pr',
      title: f.title,
      status: f.status,
      summary: ann ? `${f.title} — ${ann}` : f.title,
      path: `gh:${id}`,
      tags: ['activity', 'pr', ...(REPO_AREA[f.repo] ? [REPO_AREA[f.repo]!] : [])],
      date: f.date,
    });
    const area = REPO_AREA[f.repo];
    if (area) edges.push({ from: id, to: `area:${area}`, type: 'applies-to-area' });
  }

  // ---- lesson nodes (knowledge), indexed per-PR in event order ----
  const perPr = new Map<string, number>();
  for (const e of ofType(events, EVENT.RETRO)) {
    const p = e.payload as unknown as RetroPayload;
    const pid = prId(p.repo, p.pr);
    const idx = perPr.get(pid) ?? 0;
    perPr.set(pid, idx + 1);

    const isOpen = p.kind === 'improvement' && !p.appliedRef;
    const fresh = Date.parse(e.occurredAt) >= cutoffMs;
    if (!fresh && !isOpen) continue; // window non-open lessons; keep open improvements forever

    const id = `lesson:${pid}#${idx}`;
    nodes.push({
      id,
      kind: 'lesson',
      title: p.note.length > 80 ? `${p.note.slice(0, 77)}...` : p.note,
      status: isOpen ? 'open' : 'unknown',
      summary: `${p.kind}: ${p.note}`,
      path: `gh:${pid}`,
      tags: ['activity', 'lesson', p.kind, ...(isOpen ? ['open'] : []), ...(REPO_AREA[p.repo] ? [REPO_AREA[p.repo]!] : [])],
      date: e.occurredAt,
    });
    edges.push({ from: id, to: pid, type: 'evidenced-by' });
    const area = REPO_AREA[p.repo];
    if (area) edges.push({ from: id, to: `area:${area}`, type: 'applies-to-area' });
  }

  return { nodes, edges, warnings: [] };
}

/** File wrapper: read the local event log, project to an activity slice. Fail-soft. */
export function readActivity(logPath: string | undefined, windowDays = 60, now = Date.now()): RawSlice {
  const path = logPath ?? DEFAULT_LOG;
  if (!existsSync(path)) {
    return { nodes: [], edges: [], warnings: [`event log not found: ${path} — activity overlay skipped`] };
  }
  try {
    return eventsToActivity(readEnvelopes(path), windowDays, now);
  } catch (err) {
    return { nodes: [], edges: [], warnings: [`activity overlay failed: ${String(err)}`] };
  }
}
```

Note on the `evidenced-by` edge to a PR that was windowed out (e.g. an old open improvement whose PR node is gone): the target `repo#pr` matches `EXTERNAL_REF_RE` in `build-graph.ts` (`^[a-z-]+#\d+$`-ish) only for single-segment repos. A `de-braighter/substrate#79` target that is absent will surface as a dangling-edge *warning*, which is acceptable signal — do not suppress it.

- [ ] **Step 4: Run the reader test to confirm it passes**

Run: `npx vitest run test/knowledge-graph/activity-reader.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/knowledge-graph/sources/activity-reader.ts test/knowledge-graph/activity-reader.test.ts
git commit -m "feat(kg): activity-reader projects the event log into pr/lesson nodes"
```

---

## Task 4: Activity overlay + config wiring

**Files:**
- Modify: `src/knowledge-graph/config.ts`
- Modify: `src/knowledge-graph/index.ts`
- Test: `test/knowledge-graph/activity-overlay.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/activity-overlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeActivityOverlay } from '../../src/knowledge-graph/index.js';
import { eventsToActivity } from '../../src/knowledge-graph/sources/activity-reader.js';
import { prMerged, retro } from '../../src/events.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const recent = '2026-05-30T00:00:00Z';

// A minimal base graph with a single ADR node (the corpus side).
function baseGraph(): KgGraph {
  return {
    nodes: {
      'adr-203': { id: 'adr-203', kind: 'adr', title: 'inference to event_log', status: 'ratified', summary: 'wire inference', path: 'layers/specs/adr/adr-203.md', tags: ['substrate'] },
    },
    edges: [{ from: 'adr-203', to: 'area:substrate', type: 'applies-to-area' }],
    warnings: [],
  };
}

describe('mergeActivityOverlay', () => {
  it('adds activity nodes + edges and re-derives mentions from them to the base', () => {
    const events = [
      prMerged({ repo: 'de-braighter/specs', pr: 248, title: 'ADR-203 inference to event_log', cycleHours: 2.1, ts: recent }),
      retro({ repo: 'de-braighter/specs', pr: 248, kind: 'friction', note: 'fixtures != real corpus (see adr-203)', ts: recent }),
    ];
    const merged = mergeActivityOverlay(baseGraph(), events, 60, NOW);
    // base node preserved
    expect(merged.nodes['adr-203']).toBeDefined();
    // activity nodes added
    expect(merged.nodes['de-braighter/specs#248']?.kind).toBe('pr');
    expect(merged.nodes['lesson:de-braighter/specs#248#0']?.kind).toBe('lesson');
    // mentions re-derived FROM the activity nodes (pr title + lesson note name adr-203)
    expect(merged.edges).toContainEqual({ from: 'de-braighter/specs#248', to: 'adr-203', type: 'mentions' });
    expect(merged.edges).toContainEqual({ from: 'lesson:de-braighter/specs#248#0', to: 'adr-203', type: 'mentions' });
  });

  it('is a no-op (base untouched) when there is no activity', () => {
    const base = baseGraph();
    const merged = mergeActivityOverlay(base, [], 60, NOW);
    expect(Object.keys(merged.nodes)).toEqual(['adr-203']);
  });
});
```

(`mergeActivityOverlay` in this test takes `events` directly for hermetic unit testing; the production `loadServingIndex` passes the file path — see Step 4.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/knowledge-graph/activity-overlay.test.ts`
Expected: FAIL — `mergeActivityOverlay` not exported.

- [ ] **Step 3: Add `logPath` + `activityWindowDays` to `src/knowledge-graph/config.ts`**

Add the two fields to the `KgConfig` interface:

```ts
export interface KgConfig {
  clusterRoot: string;
  specsRoot: string;
  workbenchRoot: string;
  memoryDir: string | undefined;
  indexPath: string;
  basePath: string;
  logPath: string;
  activityWindowDays: number;
}
```

In `resolveConfig`, add to the returned object (the event log lives in the pack's own `data/`, not the cluster corpus):

```ts
    logPath: env['DEVLOOP_LOG'] ?? join(packRoot, 'data', 'events.jsonl'),
    activityWindowDays: Number(env['ACTIVITY_WINDOW_DAYS'] ?? '60'),
```

- [ ] **Step 4: Add `mergeActivityOverlay` + chain it in `loadServingIndex` (`src/knowledge-graph/index.ts`)**

Add the import near the other source imports:

```ts
import { readActivity, eventsToActivity } from './sources/activity-reader.js';
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
```

Add the overlay function (mirror of `mergeMemoryOverlay`) — overloaded to accept either events (tests) or read from a path (production):

```ts
/** Merge the activity slice (pr + lesson nodes) onto a base, re-deriving `mentions`
 *  FROM the activity nodes against the merged set — exactly like mergeMemoryOverlay.
 *  Accepts events directly (hermetic) or, in production, readActivity feeds them. */
export function mergeActivityOverlay(
  base: KgGraph,
  events: DomainEventEnvelope[],
  windowDays = 60,
  now = Date.now(),
): KgGraph {
  const act = eventsToActivity(events, windowDays, now);
  return applyActivitySlice(base, act);
}

function applyActivitySlice(base: KgGraph, act: KgGraph['nodes'] extends never ? never : ReturnType<typeof eventsToActivity>): KgGraph {
  const nodes: KgGraph['nodes'] = { ...base.nodes };
  if (act.nodes.length === 0) {
    return { nodes, edges: [...base.edges], warnings: [...base.warnings, ...act.warnings] };
  }
  for (const n of act.nodes) nodes[n.id] = n;
  const actIds = new Set(act.nodes.map((n) => n.id));
  const mentions = deriveMentionEdges(nodes).filter((e) => actIds.has(e.from));
  return { nodes, edges: [...base.edges, ...act.edges, ...mentions], warnings: [...base.warnings, ...act.warnings] };
}
```

> If the `act` parameter type expression above is awkward under `noUncheckedIndexedAccess`, simplify by typing `applyActivitySlice(base: KgGraph, act: RawSlice)` and importing `RawSlice` from `./graph-model.js`. Functionally identical.

Update `loadServingIndex` to chain the activity overlay after the memory overlay. The current final line is `return mergeMemoryOverlay(base, cfg.memoryDir);`. Replace with:

```ts
  const withMemory = mergeMemoryOverlay(base, cfg.memoryDir);
  const activity = readActivity(cfg.logPath, cfg.activityWindowDays);
  return applyActivitySlice(withMemory, activity);
```

- [ ] **Step 5: Run the overlay test + full suite**

Run: `npx vitest run test/knowledge-graph/activity-overlay.test.ts`
Expected: PASS.
Run: `npx vitest run test/`
Expected: PASS (no regressions; existing `loadServingIndex`/serving tests still green — the activity overlay is additive and fail-soft).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck` (or `npx tsc --noEmit` if that is the project's check)
Expected: PASS (clean under `noUncheckedIndexedAccess`).

- [ ] **Step 7: Commit**

```bash
git add src/knowledge-graph/config.ts src/knowledge-graph/index.ts test/knowledge-graph/activity-overlay.test.ts
git commit -m "feat(kg): mergeActivityOverlay + serve-path wiring (local activity overlay)"
```

---

## Task 5: Rank lessons above their provenance PRs

**Files:**
- Modify: `src/knowledge-graph/retrieval/rank.ts`
- Test: `test/knowledge-graph/activity-rank.test.ts`

`rankNodes(graph, seeds, reached): RankedNode[]` returns `{ id, score, hops, viaPath }[]` sorted by score desc (confirmed signature). We test it directly.

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/activity-rank.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rankNodes } from '../../src/knowledge-graph/retrieval/rank.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';
import type { SeedHit } from '../../src/knowledge-graph/retrieval/seed.js';
import type { Reached } from '../../src/knowledge-graph/retrieval/traverse.js';

// A pr and a lesson with identical seed strength, hops, and date — the ONLY
// differentiator is kind. The lesson (knowledge) must outrank the pr (provenance).
function graph(): KgGraph {
  return {
    nodes: {
      'r#1': { id: 'r#1', kind: 'pr', title: 'x', status: 'merged', summary: 'x', path: 'gh:r#1', tags: ['activity', 'pr'], date: '2026-05-30T00:00:00Z' },
      'lesson:r#1#0': { id: 'lesson:r#1#0', kind: 'lesson', title: 'x', status: 'unknown', summary: 'x', path: 'gh:r#1', tags: ['activity', 'lesson'], date: '2026-05-30T00:00:00Z' },
    },
    edges: [],
    warnings: [],
  };
}

describe('activity ranking', () => {
  it('ranks a lesson above the pr it came from (kind weight)', () => {
    const seeds: SeedHit[] = [{ id: 'r#1', score: 1 }, { id: 'lesson:r#1#0', score: 1 }];
    const reached: Reached[] = [{ id: 'r#1', hops: 0, viaPath: [] }, { id: 'lesson:r#1#0', hops: 0, viaPath: [] }];
    const ranked = rankNodes(graph(), seeds, reached);
    expect(ranked[0]!.id).toBe('lesson:r#1#0');
    expect(ranked[1]!.id).toBe('r#1');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/knowledge-graph/activity-rank.test.ts`
Expected: FAIL — with identical inputs the pr and lesson tie (or pr wins on insertion order); no kind weight yet.

- [ ] **Step 3: Add a kind weight in `rank.ts`**

Near the top of `rank.ts`, add:

```ts
import type { NodeKind } from '../graph-model.js';

// Lessons are the knowledge payload; PRs are provenance (the WHY-THIS trail).
// Multiply the composite score so a relevant lesson outranks the pr it came from
// and corpus nodes sit between them.
const KIND_WEIGHT: Record<NodeKind, number> = {
  lesson: 1.5,
  memory: 1.2,
  adr: 1,
  concept: 1,
  policy: 1,
  instruction: 1,
  pr: 0.4,
};
```

The current composite (line 29) is:

```ts
const score = (seedScore.get(r.id) ?? 0) * 2 + proximity + status + recencyWeight(node.date);
```

Replace it with the kind-weighted form (multiply the whole composite):

```ts
const score =
  ((seedScore.get(r.id) ?? 0) * 2 + proximity + status + recencyWeight(node.date)) *
  KIND_WEIGHT[node.kind];
```

- [ ] **Step 4: Run the rank test + full suite**

Run: `npx vitest run test/knowledge-graph/activity-rank.test.ts`
Expected: PASS.
Run: `npx vitest run test/`
Expected: PASS — re-run the **golden retrieval** cases especially (`test/knowledge-graph/golden-queries.test.ts`); the kind weight must not demote any corpus golden expectation. If a golden case regresses, tune the corpus weights (keep all corpus kinds at `1`; only `pr` is dampened and `lesson` boosted) rather than weakening the golden assertion.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge-graph/retrieval/rank.ts test/knowledge-graph/activity-rank.test.ts
git commit -m "feat(kg): rank lessons above provenance PRs via a per-kind weight"
```

---

## Task 6: Context-pack activity sections (LEARNED / OPEN LOOPS / FRESH)

**Files:**
- Create: `src/knowledge-graph/retrieval/activity-pack.ts`
- Modify: `src/knowledge-graph/retrieval/context-pack.ts`
- Test: `test/knowledge-graph/activity-pack.test.ts`

- [ ] **Step 1: Write the failing test for the standalone renderer**

Create `test/knowledge-graph/activity-pack.test.ts`:

Signature: `renderActivitySections(graph, rankedIds: string[], now?)` — `rankedIds` is the rank-ordered id list (highest first) the caller already has. Lessons are selected from it (preserving rank order, capped); FRESH requires *both* the corpus node and a recent mentioning PR to be relevant.

```ts
import { describe, it, expect } from 'vitest';
import { renderActivitySections } from '../../src/knowledge-graph/retrieval/activity-pack.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const recent = '2026-05-30T00:00:00Z';

function graph(): KgGraph {
  return {
    nodes: {
      'adr-203': { id: 'adr-203', kind: 'adr', title: 'inference to event_log', status: 'ratified', summary: 's', path: 'p', tags: ['substrate'] },
      'de-braighter/specs#248': { id: 'de-braighter/specs#248', kind: 'pr', title: 'ADR-203 ship', status: 'merged', summary: 'ADR-203 ship', path: 'gh:de-braighter/specs#248', tags: ['activity', 'pr'], date: recent },
      'lesson:specs#1#0': { id: 'lesson:specs#1#0', kind: 'lesson', title: 'add distractor fixtures', status: 'open', summary: 'improvement: add distractor fixtures', path: 'gh', tags: ['activity', 'lesson', 'improvement', 'open'], date: recent },
      'lesson:specs#2#0': { id: 'lesson:specs#2#0', kind: 'lesson', title: 'fixtures != real corpus', status: 'unknown', summary: 'friction: fixtures != real corpus', path: 'gh', tags: ['activity', 'lesson', 'friction'], date: recent },
    },
    edges: [
      { from: 'de-braighter/specs#248', to: 'adr-203', type: 'mentions' },
      { from: 'lesson:specs#2#0', to: 'de-braighter/specs#248', type: 'evidenced-by' },
    ],
    warnings: [],
  };
}

const RANKED = ['lesson:specs#1#0', 'lesson:specs#2#0', 'adr-203', 'de-braighter/specs#248'];

describe('renderActivitySections', () => {
  it('renders LEARNED with non-open lessons, citing PR provenance', () => {
    const out = renderActivitySections(graph(), RANKED, NOW);
    expect(out).toContain('LEARNED');
    expect(out).toContain('fixtures != real corpus');
    expect(out).toContain('de-braighter/specs#248'); // evidenced-by provenance citation
  });

  it('renders OPEN LOOPS with open-status lessons only', () => {
    const out = renderActivitySections(graph(), RANKED, NOW);
    const openBlock = out.slice(out.indexOf('OPEN LOOPS'));
    expect(out).toContain('OPEN LOOPS');
    expect(openBlock).toContain('add distractor fixtures');
    expect(openBlock).not.toContain('fixtures != real corpus'); // non-open lives in LEARNED
  });

  it('renders FRESH for a relevant corpus node touched by a relevant recent pr', () => {
    const out = renderActivitySections(graph(), RANKED, NOW);
    expect(out).toContain('FRESH');
    expect(out).toContain('adr-203');
  });

  it('returns empty string when no activity is relevant', () => {
    expect(renderActivitySections(graph(), ['adr-203'], NOW)).toBe('');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/knowledge-graph/activity-pack.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/knowledge-graph/retrieval/activity-pack.ts`**

```ts
import type { KgGraph, KgNode } from '../graph-model.js';

const DAY_MS = 86_400_000;
const FRESH_DAYS = 30;
const LESSON_CAP = 5; // keep the pack lean — top-ranked lessons per section

function ageDays(date: string | undefined, now: number): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return (now - Date.parse(date)) / DAY_MS;
}

/** The PR a lesson was captured on (via its evidenced-by edge), for provenance. */
function provenanceOf(graph: KgGraph, lessonId: string): string | undefined {
  return graph.edges.find((e) => e.from === lessonId && e.type === 'evidenced-by')?.to;
}

/** Activity view over the rank-ordered relevant ids. Returns '' when no activity is
 *  relevant, so the caller can concatenate unconditionally. Order of `rankedIds` is
 *  preserved (highest-ranked lessons first); each section is capped. */
export function renderActivitySections(graph: KgGraph, rankedIds: string[], now = Date.now()): string {
  const relevant = new Set(rankedIds);
  const ordered: KgNode[] = rankedIds.map((id) => graph.nodes[id]).filter((n): n is KgNode => Boolean(n));

  const lessons = ordered.filter((n) => n.kind === 'lesson');
  const openLoops = lessons.filter((n) => n.status === 'open').slice(0, LESSON_CAP);
  const learned = lessons.filter((n) => n.status !== 'open').slice(0, LESSON_CAP);

  const lessonLine = (n: KgNode): string => {
    const pr = provenanceOf(graph, n.id);
    return `  • ${n.summary}${pr ? ` (from ${pr})` : ''}  [${n.id}]`;
  };

  // FRESH: a relevant corpus node (adr/concept) touched by a relevant PR dated within
  // the window — both endpoints must be task-relevant so we never surface noise.
  const fresh: string[] = [];
  for (const n of ordered) {
    if (n.kind !== 'adr' && n.kind !== 'concept') continue;
    const live = graph.edges.some(
      (e) =>
        e.to === n.id &&
        e.type === 'mentions' &&
        relevant.has(e.from) &&
        graph.nodes[e.from]?.kind === 'pr' &&
        ageDays(graph.nodes[e.from]?.date, now) <= FRESH_DAYS,
    );
    if (live) fresh.push(`  • ${n.id} — live (touched by a PR in the last ${FRESH_DAYS}d)`);
  }

  const blocks: string[] = [];
  if (learned.length) blocks.push('LEARNED (recent activity):\n' + learned.map(lessonLine).join('\n'));
  if (openLoops.length) blocks.push('OPEN LOOPS:\n' + openLoops.map(lessonLine).join('\n'));
  if (fresh.length) blocks.push('FRESH:\n' + fresh.join('\n'));
  return blocks.join('\n');
}
```

- [ ] **Step 4: Run the renderer test to confirm it passes**

Run: `npx vitest run test/knowledge-graph/activity-pack.test.ts`
Expected: PASS.

- [ ] **Step 5: Integrate the activity sections into `buildContextPack` (exact edit)**

`context-pack.ts` assembles `out: string[]` (TASK/RULES/DECIDED/LEARNED/WHY/FILES/MORE) and returns `out.join('\n')`. The existing loop runs `classifyNode` on every ranked node — now that `pr`/`lesson` are real nodes they would otherwise be mis-rendered as bare `id (title)` lines. So we (a) skip activity kinds in the corpus loop entirely (they consume no corpus budget and produce no corpus line), and (b) append the activity sections from the full ranked id list, budget-guarded.

Add the import at the top:

```ts
import { renderActivitySections } from './activity-pack.js';
```

Inside the loop, immediately after `const n = graph.nodes[r.id]; if (!n) continue;`, skip activity kinds *before* any budget accounting (they are rendered by `renderActivitySections`, not as RULES/DECIDED/LEARNED/FILES):

```ts
    const n = graph.nodes[r.id];
    if (!n) continue;
    if (n.kind === 'pr' || n.kind === 'lesson') continue; // rendered as activity sections
```

Replace the final `return out.join('\n');` with a budget-guarded append that feeds the renderer the full rank-ordered id list:

```ts
  const pack = out.join('\n');
  const activity = renderActivitySections(graph, ranked.map((r) => r.id));
  if (!activity) return pack;
  const withActivity = `${pack}\n${activity}`;
  return withActivity.length <= charCap ? withActivity : pack; // never overflow the budget
```

- [ ] **Step 6: End-to-end test via `contextFor` + full suite**

Add to `test/knowledge-graph/activity-pack.test.ts` (or a new `activity-context.test.ts`) an end-to-end assertion through the public API:

```ts
import { contextFor } from '../../src/knowledge-graph/index.js';
// reuse graph() above
it('contextFor surfaces lessons + open loops for a matching task', () => {
  const out = contextFor('fixtures distractor', graph(), 4000);
  expect(out).toMatch(/LEARNED|OPEN LOOPS/);
});
```

Run: `npx vitest run test/`
Expected: PASS (all suites; golden cases unaffected — activity sections are appended, not substituted).

- [ ] **Step 7: Commit**

```bash
git add src/knowledge-graph/retrieval/activity-pack.ts src/knowledge-graph/retrieval/context-pack.ts test/knowledge-graph/activity-pack.test.ts
git commit -m "feat(kg): context-pack LEARNED/OPEN LOOPS/FRESH activity sections"
```

---

## Task 7: Golden case, README, full gate, Sonar babysit

**Files:**
- Modify: the read-side golden-query test (search for it: `grep -rl "golden" test/`)
- Modify: `src/knowledge-graph/README.md`

- [ ] **Step 1: Add a write-side golden case**

Find the golden suite (`grep -rl "golden" test/knowledge-graph/` — likely `golden.test.ts` or within a retrieval test). Add a case that builds a small graph with a corpus ADR + a `lesson` on the same area + an `open` improvement, runs `contextFor`, and asserts:

```ts
it('golden: kernel-persistence task surfaces the lesson and the open loop, lesson above the pr', () => {
  // build a fixture graph: adr-200 (ratified, area substrate),
  // a pr 'ADR-200 effect persistence' mentioning adr-200,
  // a lesson 'verify against the real corpus, not fixtures' (friction),
  // an open improvement 'add distractor golden fixtures'.
  // (construct KgGraph literally, as in activity-pack.test.ts)
  const out = contextFor('kernel persistence', fixture, 4000);
  expect(out).toContain('verify against the real corpus');
  expect(out).toContain('OPEN LOOPS');
  expect(out).toContain('add distractor golden fixtures');
});
```

Write the `fixture` graph literally following the node shapes used in Task 6's test. Run: `npx vitest run` on that file; expect PASS.

- [ ] **Step 2: Document the write-side in `src/knowledge-graph/README.md`**

Add a short section: the activity overlay (local, from `data/events.jsonl`, never to S3), the `Lesson:` PR-body convention with examples, and the `ACTIVITY_WINDOW_DAYS` / `DEVLOOP_LOG` env knobs. Keep it factual and brief (it will pass `md-quality-review`).

- [ ] **Step 3: Run the full local gate**

Run: `npm run ci:local`
Expected: PASS — typecheck clean (`noUncheckedIndexedAccess`), lint clean, all Vitest suites green. Fix anything red before proceeding; do not move on with a red gate.

- [ ] **Step 4: Sonar babysit (own-code clean)**

Start the local SonarQube if down (containers `db-sonar-sonarqube-1` + `db-sonar-sonar-db-1`; ~90s to UP; mint a token via `SONAR_ADMIN_PW` from `de-braighter/.env` — devloop has no `tools/sonar/.token`). Then:

Run: `npm run sonar:scan` (non-fatal by design)
Then inspect new-code measures on `localhost:9000` for project `devloop`.
Expected: **own code 0 new violations, 0 duplication, new-coverage high.** Watch specifically:
- **S5852 (ReDoS)** on `LESSON_RE` — review like the existing `EFFECT_RE`/`PRODUCER_RE` hotspots; the pattern is linear (no nested quantifiers on overlapping classes) → mark REVIEWED/SAFE (trusted local PR-body input), matching the prior `#33` disposition.
- **S6551** (`String(unknownVal)`) — the `String((prod.payload as ...).producer ...)` cast in `backfill`: keep it guarded with `?? ''`.
- **S1874** — ensure no deprecated MCP `server.tool(...)` slipped in (we did not touch `mcp/server.ts`).

Fix any new violations in your diff; the pre-existing baseline must remain at 0 new (main is re-baselined green).

- [ ] **Step 5: Commit + push the branch**

```bash
git add -A src/ test/
git commit -m "test(kg): write-side golden case + README; gate green"
git push -u origin docs/kg-write-side-design
```

(Note: the spec commit `30ad190` is in the **workbench** repo on branch `docs/kg-write-side-design`; the code commits are in the **devloop** repo. Open one PR per repo — the workbench PR carries the spec + this plan, the devloop PR carries the implementation. Cross-link them.)

- [ ] **Step 6: Open the devloop PR with the SDLC ritual lines**

```bash
gh pr create --repo de-braighter/devloop --title "feat(kg): SDLC knowledge graph write-side emit-loop (phase 2)" --body "$(cat <<'EOF'
Implements the write-side of the SDLC knowledge graph: project the local event
log into pr/lesson nodes as an activity overlay; `Lesson:` PR-body convention as
the capture path. Local overlay only — S3 base/image/CronJob untouched. Spec +
plan: de-braighter/workbench (branch docs/kg-write-side-design).

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Lesson: win — the knowledge-extraction (retros/openImprovements, declared-effect gap) already existed; the write-side is projection plumbing, not new inference

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Verifier wave + drain**

Run the verifier wave (`local-ci` + `reviewer` + `qa-engineer`, `isolation: "worktree"`; the charter-checkers do not apply — devloop is not a kernel/exercir change but run `charter-checker` for the ADR-176 "no kernel creep" check). After the wave: `npm run dev -- drain de-braighter/devloop#<PR>` to PR-scope the verdicts. After merge: `… backfill` then `… reconcile` (which will now also parse this PR's own `Lesson:` line), then `… retro` per cadence.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §1.2 three layers — lessons (Task 3 lesson nodes + Task 6 LEARNED), open-loops (Task 3 `open` status + unobserved-effect annotation + Task 6 OPEN LOOPS), freshness (Task 6 FRESH). ✓
- §1.3 local overlay, not shared base — Task 4 `loadServingIndex` chains activity AFTER memory; `buildBaseIndex`/`publishBase` untouched. ✓
- D1/D6 capture via `Lesson:` parsed in `backfill` — Task 2. ✓
- D2 pr=provenance(low) / lesson=knowledge(high); open-loops/heat derived at pack-time — Tasks 3, 5, 6. ✓
- D3 placement + convergence via deterministic ids — Task 3 ids + Task 4 overlay. ✓
- D4 reuse `deriveMentionEdges` + `applies-to-area` + new `evidenced-by` — Tasks 1, 3, 4. ✓
- D5 window 60d + dedup by id + open improvements never expire — Task 3 (window test) + Task 4 config knob. ✓
- §6 grammar, left-anchor hardening, `by` resolution — Task 2 tests. ✓
- §8 test tiers — parser (T2), reader (T3), overlay (T4), golden + pack (T6/T7). ✓
- §9 constraints (no kernel change, base/image/CronJob untouched, ESM `.js`, `noUncheckedIndexedAccess`, English, Sonar) — Tasks 4/7. ✓

**Placeholder scan:** None. `rank.ts` and `context-pack.ts` were read in full; Tasks 5 & 6 give the exact current line and the exact replacement (kind-weighted composite; skip-activity-in-loop + `renderActivitySections` append). `renderActivitySections` is fully specified and unit-tested; `rankNodes` is tested directly against its confirmed `RankedNode[]` return shape.

**Type consistency:** `eventsToActivity(events, windowDays, now)` and `readActivity(logPath, windowDays, now)` consistent across Tasks 3–4; `mergeActivityOverlay(base, events, windowDays, now)` + `applyActivitySlice(base, RawSlice)`; `renderActivitySections(graph, rankedIds, now)` consistent across Tasks 6–7. Node ids: `pr` = `repo#pr`, `lesson` = `lesson:repo#pr#idx` — consistent everywhere. Edge `evidenced-by` direction lesson→pr throughout.
