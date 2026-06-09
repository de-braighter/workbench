# devloop `effort` lever — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-declared, process-anchored `Effort:` tier (`light|standard|deep`) to the PR ritual, carried on the existing `ProducerAttributed` event, and expose it as one new lever in the `whatIf` engine with an always-on operator-choice warning.

**Architecture:** Reuse the entire delivery-what-if path. Effort rides on the existing producer event (additive optional field — no event version bump). The what-if engine gains one lever and one warning; repo-conditioning, thin-stratum exclusion, and temporal-overlap → `INCONCLUSIVE` are inherited unchanged.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), Zod, vitest. Pure in-process pack — no NestJS/Postgres.

**Spec:** `docs/superpowers/specs/2026-06-09-devloop-effort-lever-design.md`

---

## Repos & working directories

- **Tasks 1–4** run in the **devloop domain repo**: `domains/devloop/`. All commands below (`npx vitest`, `npm run typecheck`, `git`) are run **from `domains/devloop/`**. It is its own git repo — branch + commit there.
- **Task 5** runs in the **workbench repo root**: `D:/development/projects/de-braighter/` (the `CLAUDE.md` ritual table). Different repo, different branch.

**Branch (devloop repo), before Task 1:**

```bash
cd domains/devloop
git checkout -b feat/effort-lever
```

## File structure (what each touched file is responsible for)

| File | Repo | Responsibility | Change |
|---|---|---|---|
| `src/events.ts` | devloop | event schemas + constructors | add `EFFORT_TIERS`/`Effort` + `effort` on `Producer` schema |
| `src/ingest/github.ts` | devloop | PR-body → events parse | add `EFFORT_RE`, read it in `parseProducer` |
| `src/inference/whatif.ts` | devloop | stratified-conditional what-if | add `effort` lever + operator-choice warning |
| `src/cli.ts` | devloop | CLI surface | add `effort` to the `whatif` usage string |
| `docs/m2-sdlc-counterfactual-design.md` | devloop | M2 design doc | add `effort` to the lever list |
| `test/effort.test.ts` | devloop | schema/constructor tests | **create** |
| `test/producer-parse.test.ts` | devloop | `parseProducer` tests | add `Effort:` parse cases |
| `test/whatif.test.ts` | devloop | what-if lever tests | add `effort` lever describe block |
| `CLAUDE.md` | workbench | PR-ritual conventions | add `Effort:` bullet + anchored-tier table |

---

## Task 1: `effort` on the producer event schema

**Files:**
- Modify: `domains/devloop/src/events.ts` (add tiers near line 25; add field on `Producer` schema at line 33)
- Test: `domains/devloop/test/effort.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `domains/devloop/test/effort.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { producer, EVENT, EFFORT_TIERS } from '../src/events.js';

const TS = '2026-06-09T12:00:00.000Z';

describe('effort tier on the producer event', () => {
  it('exposes the three anchored tiers', () => {
    expect([...EFFORT_TIERS]).toEqual(['light', 'standard', 'deep']);
  });

  it('carries an optional effort tier in the payload', () => {
    const e = producer({ repo: 'r', pr: 7, producer: 'orchestrator', model: 'claude-opus-4-8', effort: 'deep', ts: TS });
    expect(e.eventType).toBe(EVENT.PRODUCER);
    expect(e.payload).toMatchObject({ effort: 'deep' });
  });

  it('effort is optional — absent leaves it undefined', () => {
    const e = producer({ repo: 'r', pr: 1, producer: 'orchestrator', model: 'claude-opus-4-8', ts: TS });
    expect((e.payload as { effort?: unknown }).effort).toBeUndefined();
  });

  it('rejects a non-tier value at validation time', () => {
    // @ts-expect-error invalid tier must not type-check
    expect(() => producer({ repo: 'r', pr: 1, producer: 'o', model: 'm', effort: 'heroic', ts: TS })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `domains/devloop/`): `npx vitest run test/effort.test.ts`
Expected: FAIL — `EFFORT_TIERS` is not exported; `effort: 'deep'` is stripped by Zod so `payload.effort` is undefined; the `'heroic'` call does not throw.

- [ ] **Step 3: Write minimal implementation**

In `src/events.ts`, immediately after `export const VERDICT_VALUES = ['PASS', 'NOTES', 'BLOCKING'] as const;` (line 25), add:

```ts
// Effort tiers (anchored to process facts in CLAUDE.md): light = single pass / no wave;
// standard = verifier wave; deep = wave + designer-first and/or ≥2 review rounds.
export const EFFORT_TIERS = ['light', 'standard', 'deep'] as const;
export type Effort = (typeof EFFORT_TIERS)[number];
```

Then add the optional field to the `Producer` schema (line 33), so it becomes:

```ts
const Producer = z.object({ repo: z.string(), pr: z.number().int(), producer: z.string(), model: z.string(), skills: z.array(z.string()).optional(), effort: z.enum(EFFORT_TIERS).optional() });
```

(`ProducerPayload` is `z.infer<typeof Producer>` already — it now includes `effort` automatically. The `producer()` constructor already does `Producer.parse(i)`, so the new field flows through with no constructor change. This is an additive optional field on `ProducerAttributed.v1` → backward-compatible, no `.v2`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/effort.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck (verifies the `@ts-expect-error` is real)**

Run: `npm run typecheck`
Expected: exit 0 — the `'heroic'` line is rejected by `tsc`, satisfying `@ts-expect-error`.

- [ ] **Step 6: Commit**

```bash
git add src/events.ts test/effort.test.ts
git commit -m "feat(events): optional effort tier on the producer event

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: parse the `Effort:` PR-body line

**Files:**
- Modify: `domains/devloop/src/ingest/github.ts:7` (import), add `EFFORT_RE` after line 40, edit `parseProducer` (lines 43-49)
- Test: `domains/devloop/test/producer-parse.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

Append to `domains/devloop/test/producer-parse.test.ts`, inside the existing `describe('Producer: PR-body parse ...')` block (before its closing `});`):

```ts
  it('captures an Effort: tier alongside the producer (case-insensitive)', () => {
    const e = parseProducer('Adds X.\n\nProducer: orchestrator/claude-opus-4-8\nEffort: Deep', 'r', 7, TS)!;
    expect(e.payload).toMatchObject({ producer: 'orchestrator', effort: 'deep' });
  });

  it('effort is optional — a Producer: line with no Effort: line leaves it undefined', () => {
    const e = parseProducer('Producer: orchestrator/opus', 'r', 1, TS)!;
    expect((e.payload as { effort?: unknown }).effort).toBeUndefined();
  });

  it('ignores a non-tier Effort: value', () => {
    const e = parseProducer('Producer: orchestrator/opus\nEffort: heroic', 'r', 1, TS)!;
    expect((e.payload as { effort?: unknown }).effort).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/producer-parse.test.ts`
Expected: FAIL — the first new test fails (`effort` is undefined; the parse doesn't read `Effort:` yet).

- [ ] **Step 3: Write minimal implementation**

In `src/ingest/github.ts`, add `type Effort` to the events import on line 7:

```ts
import { EVENT, prOpened, prMerged, verdict, producer, effectDeclared, retro, correction, override, parsePrRef, type Effort } from '../events.js';
```

Add this regex immediately after `PRODUCER_RE` (after line 40):

```ts
// Effort tier (anchored: light|standard|deep) declared next to Producer:, e.g. `Effort: deep`.
// Left-anchored like PRODUCER_RE so substrings can't fabricate a value. Effort is producer
// provenance — read here and attached to the producer event (no Producer: line → no event).
const EFFORT_RE = /(?:^|\s)Effort:\s*(light|standard|deep)\b/i;
```

Edit `parseProducer` (lines 43-49) to read it and pass it through:

```ts
export function parseProducer(body: string | null | undefined, repo: string, pr: number, ts: string): DomainEventEnvelope | null {
  if (!body) return null;
  const m = PRODUCER_RE.exec(body);
  if (!m) return null;
  const skills = m[3] ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const effort = EFFORT_RE.exec(body)?.[1]?.toLowerCase() as Effort | undefined;
  return producer({ repo, pr, producer: m[1]!, model: m[2]!, skills: skills?.length ? skills : undefined, effort, ts });
}
```

(A non-tier value like `heroic` fails the `(light|standard|deep)` group, so `EFFORT_RE.exec` returns null → `effort` is undefined. No extra guard needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/producer-parse.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/github.ts test/producer-parse.test.ts
git commit -m "feat(ingest): parse Effort: tier from the PR body

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: the `effort` lever + operator-choice warning in `whatIf`

**Files:**
- Modify: `domains/devloop/src/inference/whatif.ts` (`leverValues` lines 84-104; the unsupported-lever string ~line 115; add the warning in `whatIf`)
- Test: `domains/devloop/test/whatif.test.ts` (add describe block)

- [ ] **Step 1: Write the failing test**

Append to `domains/devloop/test/whatif.test.ts` (after the last describe, before EOF):

```ts
describe('whatIf — effort lever', () => {
  const mergeE = (repo: string, pr: number, cycleHours: number, ts: string, effort?: 'light' | 'standard' | 'deep') => [
    prMerged({ repo, pr, title: 'x', cycleHours, ts }),
    producer({ repo, pr, producer: 'orchestrator', model: 'claude-opus-4-8', effort, ts }),
  ];

  it('stratifies an indicator by effort tier (model held constant)', () => {
    const events = [];
    for (let i = 0; i < 6; i++) events.push(...mergeE('r', i + 1, 0.5, `2026-05-${10 + i}T10:00:00.000Z`, 'deep'));
    for (let i = 0; i < 6; i++) events.push(...mergeE('r', i + 101, 0.1, `2026-05-${11 + i}T10:00:00.000Z`, 'standard'));
    const w = whatIf(events, { repo: 'r', indicator: 'cycle-time', by: 'effort' });
    expect(w.strata.map((s) => s.value).sort()).toEqual(['deep', 'standard']);
    expect(w.conclusive).toBe(true);
  });

  it('always warns that effort is operator-chosen (difficulty-confound)', () => {
    const events = [];
    for (let i = 0; i < 6; i++) events.push(...mergeE('r', i + 1, 0.5, `2026-05-${10 + i}T10:00:00.000Z`, 'deep'));
    for (let i = 0; i < 6; i++) events.push(...mergeE('r', i + 101, 0.1, `2026-05-${11 + i}T10:00:00.000Z`, 'standard'));
    const w = whatIf(events, { repo: 'r', indicator: 'cycle-time', by: 'effort' });
    expect(w.warnings.some((x) => /operator-chosen|DIFFICULTY/i.test(x))).toBe(true);
  });

  it('excludes PRs that did not declare effort', () => {
    const events = [];
    for (let i = 0; i < 6; i++) events.push(...mergeE('r', i + 1, 0.5, `2026-05-${10 + i}T10:00:00.000Z`, 'deep'));
    for (let i = 0; i < 6; i++) events.push(...mergeE('r', i + 101, 0.1, `2026-05-${11 + i}T10:00:00.000Z`, 'standard'));
    events.push(...mergeE('r', 999, 0.2, '2026-05-20T10:00:00.000Z')); // no Effort: declared
    const w = whatIf(events, { repo: 'r', indicator: 'cycle-time', by: 'effort' });
    expect(w.warnings.some((x) => /lack a 'effort' attribution/.test(x))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/whatif.test.ts`
Expected: FAIL — `by: 'effort'` is unsupported, so `whatIf` returns the `empty(...)` "lever 'effort' not supported" result (no strata, no operator-choice warning).

- [ ] **Step 3: Write minimal implementation**

In `src/inference/whatif.ts`, edit `leverValues` (lines 84-104). Change the recognise-lever guard (line 87) to also accept `effort`:

```ts
  if (!CATEGORICAL.has(by) && !skill && !PR_DERIVED.has(by) && by !== 'effort') return { values, ok: false };
```

Inside the `for (const e of ofType(events, EVENT.PRODUCER))` loop, immediately after `if (p.repo !== repo) continue;`, add the effort branch (placing a PR only when it declared a tier):

```ts
    if (by === 'effort') { if (p.effort) values.set(p.pr, p.effort); continue; } // only PRs that DECLARED an effort tier
```

Update the unsupported-lever message (the `if (!ok) return empty(...)` line ~115) to list `effort`:

```ts
  if (!ok) return empty(`lever '${by}' not supported (try: change-type | author | model | provider | producer | effort | skill:<name>)`);
```

Immediately **after** that `if (!ok)` line, add the always-on operator-choice warning:

```ts
  if (by === 'effort') warnings.push('effort is operator-chosen — harder changes draw deeper effort; Δ may reflect DIFFICULTY, not effort. Condition on change-type (deferred) or randomize (deferred) for a causal read.');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/whatif.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Full suite + typecheck (no regressions)**

Run: `npx vitest run && npm run typecheck`
Expected: all tests PASS, typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/inference/whatif.ts test/whatif.test.ts
git commit -m "feat(whatif): effort lever with operator-choice (difficulty-confound) warning

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: docs in the devloop repo (CLI help + M2 design doc)

**Files:**
- Modify: `domains/devloop/src/cli.ts:110` (whatif usage string)
- Modify: `domains/devloop/docs/m2-sdlc-counterfactual-design.md` (lever list)

- [ ] **Step 1: Update the CLI usage string**

In `src/cli.ts`, line 110, add `effort` to the `by=` list so it reads:

```ts
  if (!repo) { console.log('usage: whatif <owner/repo> [indicator=cycle-time|cleanliness] [by=change-type|author|model|provider|producer|effort|skill:<name>]'); return; }
```

- [ ] **Step 2: Update the M2 design-doc lever list**

In `domains/devloop/docs/m2-sdlc-counterfactual-design.md`, in the model table row `| **Intervention nodes** | ... |`, append `**effort** (light/standard/deep — self-declared, anchored)` to the list of levers. And under **Build slices → S2**, append a sentence: `The self-declared **effort** lever (light/standard/deep) ships here too, with an always-on operator-choice warning (effort is endogenous to difficulty); change-type conditioning to de-confound it is deferred (S2.1).`

- [ ] **Step 3: Verify the CLI prints the new lever**

Run (from `domains/devloop/`): `npx tsx src/cli.ts whatif`
Expected: usage line printed, now including `producer|effort|skill:<name>`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts docs/m2-sdlc-counterfactual-design.md
git commit -m "docs(whatif): document the effort lever (CLI help + M2 design)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Open the devloop PR**

```bash
git push -u origin feat/effort-lever
gh pr create --repo de-braighter/devloop --title "feat: effort lever — what effort buys what outcome, model held constant" --body "$(cat <<'EOF'
Adds a self-declared, process-anchored `Effort:` tier (light|standard|deep) on the producer event, exposed as one new `whatIf` lever with an always-on operator-choice (difficulty-confound) warning. Spec: docs/superpowers/specs/2026-06-09-devloop-effort-lever-design.md (workbench).

Change-type conditioning + randomization named as deferred upgrades.

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Effort: standard
Effect: findings 0±1 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Then run the verifier wave + the twin ritual `drain → backfill → reconcile` per `policies/git.md` after the wave/merge.)

---

## Task 5: the `Effort:` ritual convention in `CLAUDE.md` (WORKBENCH repo)

**This task is in a different repo** — the workbench root (`D:/development/projects/de-braighter/`), not `domains/devloop/`. It documents the convention for humans/agents writing PR bodies.

**Files:**
- Modify: `CLAUDE.md` (the "Feed the SDLC twin on PRs" section, after the `Producer:` line bullet)

- [ ] **Step 1: Add the `Effort:` bullet + anchored-tier table**

In `CLAUDE.md`, in the bulleted list under **"Feed the SDLC twin on PRs (any repo)"**, immediately **after** the bullet that begins `**`Producer:` line**`, insert a new bullet:

```markdown
  - **`Effort:` line** — `Effort: light|standard|deep` — a self-declared, process-anchored tier the `whatif … effort` lever stratifies an indicator by, *with the model held constant* (so an outcome difference attributes to effort, not model). Optional + non-gating, like `Effect:`. Pick the row matching what the PR **actually got**:

    | Tier | Anchor |
    |---|---|
    | `light` | single pass, no verifier wave |
    | `standard` | verifier wave (reviewer + qa-engineer + charter-checker) |
    | `deep` | wave + designer-first spec **and/or** ≥2 review rounds |

    Effort is **operator-chosen** (you spend `deep` on harder changes), so the lever ships with a difficulty-confound warning — read a single Δ as a decision aid, not a causal claim.
```

- [ ] **Step 2: Markdown lint (if configured) + visual check**

Run: `git diff CLAUDE.md` and confirm the table renders (pipes aligned, blank line before the table).

- [ ] **Step 3: Commit (on the existing workbench spec branch)**

The workbench is already on branch `docs/devloop-effort-lever-design` (carrying the spec + this plan). Commit the ritual-doc update there:

```bash
# from the workbench root D:/development/projects/de-braighter/
git add CLAUDE.md
git commit -m "docs(claude): document the Effort: PR-ritual convention + anchored tiers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(The workbench branch — spec + plan + CLAUDE.md — becomes its own PR against the workbench repo, separate from the devloop code PR.)

---

## Definition of done

- [ ] `npx vitest run` green in `domains/devloop/` (effort schema, parse, lever tests included).
- [ ] `npm run typecheck` exit 0 in `domains/devloop/`.
- [ ] `devloop whatif <repo> cycle-time effort` stratifies by tier and always prints the operator-choice warning.
- [ ] devloop code PR opened (`feat/effort-lever`), verifier wave + twin ritual run.
- [ ] workbench PR opened carrying the spec + plan + `CLAUDE.md` `Effort:` convention.
