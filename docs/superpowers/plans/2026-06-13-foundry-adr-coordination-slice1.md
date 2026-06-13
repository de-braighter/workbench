# Foundry ADR-Coordination (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Foundry an atomic, collision-proof ADR-number allocator (`reserveAdr`) and teach `/build-path` to reserve a number per ADR + emit ADR-authoring items, so parallel designer-first workers can never collide on `next-free-adr` (the O-1/O-6.1→227 and O-4→"O-2" bug class).

**Architecture:** A new event-sourced allocator mirroring the existing claim pattern: a `foundry:AdrReserved.v1` event + a `reserveAdr` op that runs under the *same* `withStoreLock` mkdir-mutex that already makes `claim()` collision-proof. The `adrNumber → itemId` binding lives in a new `AdrReservation` aggregate folded into `DerivedState` (the WorkItem schema is untouched — ADR-176-minimal). `reserveAdr` is a **standalone op** (not folded into `queuePush`) because atomicity comes from the shared store-lock, not from co-location — `/build-path` calls it per ADR-needing item. The allocator is seeded by a `floor` = the specs repo's current `next-free-adr`, so it accounts for pre-existing ADRs the log never saw.

**Tech Stack:** TypeScript (ESM, explicit `.js` imports), Zod, Vitest, the MCP SDK. Repo: `domains/foundry` (npm, `ci:local = typecheck && test:coverage`). Skill edits in the workbench (`.claude/skills/`).

---

## File Structure

**`domains/foundry` (PR-A — code, verifier wave):**
- Modify `src/scope.ts` — add `adrAggregateId(repo, adrNumber)`.
- Modify `src/events.ts` — add `EVENT.ADR_RESERVED`, the `AdrReserved` schema + payload type + `adrReserved()` constructor.
- Modify `src/state.ts` — add `AdrReservationState`, `DerivedState.adrs`, the fold case, and helpers `adrKey` / `maxReservedAdr` / `adrReservationForItem`.
- Modify `src/ops.ts` — add `ReserveAdrInput` + `reserveAdr()`.
- Modify `src/mcp/tools.ts` + `src/mcp/server.ts` — expose `foundry_reserve_adr`.
- Create `test/ops-adr-reserve.test.ts` — the op + fold tests.
- Modify `test/events.test.ts`, `test/scope.test.ts`, `test/mcp-tools.test.ts` — constructor/id/tool tests.

**Workbench (PR-B — declarative + design docs):**
- Modify `.claude/skills/build-path/SKILL.md` — steps 5/7/8 (reserve numbers, emit ADR items, disjointness).
- Modify `.claude/skills/foundry-worker/SKILL.md` — designer-first consumes the reserved number.
- Commit `docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` + this plan.

---

### Task 1: `adrAggregateId` (deterministic ADR aggregate id)

**Files:**
- Modify: `src/scope.ts` (after line 26)
- Test: `test/scope.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/scope.test.ts`:

```ts
import { adrAggregateId } from '../src/scope.js';

describe('adrAggregateId', () => {
  it('is deterministic and distinct per (repo, number)', () => {
    expect(adrAggregateId('de-braighter/specs', 229)).toBe(adrAggregateId('de-braighter/specs', 229));
    expect(adrAggregateId('de-braighter/specs', 229)).not.toBe(adrAggregateId('de-braighter/specs', 230));
    expect(adrAggregateId('de-braighter/specs', 229)).not.toBe(adrAggregateId('de-braighter/health', 229));
    expect(adrAggregateId('de-braighter/specs', 229)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scope.test.ts -t adrAggregateId`
Expected: FAIL — `adrAggregateId is not a function` / import error.

- [ ] **Step 3: Add the implementation** — append to `src/scope.ts`:

```ts
export const adrAggregateId = (repo: string, adrNumber: number): string =>
  uuidv5(`adr:${repo}#${adrNumber}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scope.test.ts -t adrAggregateId`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scope.ts test/scope.test.ts
git commit -m "feat(foundry): adrAggregateId — deterministic ADR aggregate id"
```

---

### Task 2: `AdrReserved` event + constructor

**Files:**
- Modify: `src/events.ts` (EVENT block ~15-24; import ~10-13; schemas ~43-71; types ~73-80; constructors ~98-122)
- Test: `test/events.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/events.test.ts`:

```ts
import { adrReserved, EVENT } from '../src/events.js';
import { adrAggregateId } from '../src/scope.js';

describe('adrReserved', () => {
  const ts = '2026-06-13T12:00:00.000Z';
  it('builds a valid envelope with the Adr aggregate + foundry:queue actor', () => {
    const e = adrReserved({ adrNumber: 229, itemId: 'oncology/ADR-229', repo: 'de-braighter/specs', ts });
    expect(e.eventType).toBe(EVENT.ADR_RESERVED);
    expect(e.aggregateType).toBe('Adr');
    expect(e.aggregateId).toBe(adrAggregateId('de-braighter/specs', 229));
    expect(e.metadata.actorRef).toBe('foundry:queue');
    expect(e.payload).toMatchObject({ adrNumber: 229, itemId: 'oncology/ADR-229', repo: 'de-braighter/specs' });
    expect(e.occurredAt).toBe(ts);
  });
  it('rejects a non-positive adrNumber', () => {
    expect(() => adrReserved({ adrNumber: 0, itemId: 'x', repo: 'r', ts })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/events.test.ts -t adrReserved`
Expected: FAIL — `adrReserved` is not exported.

- [ ] **Step 3: Implement** — three edits in `src/events.ts`:

(a) Add to the `EVENT` object (after `GATE_DECIDED` line 23):
```ts
  ADR_RESERVED: 'foundry:AdrReserved.v1',
```
(b) Add `adrAggregateId` to the scope import (line 11-13 block):
```ts
import {
  FOUNDRY_TENANT_PACK_ID, PACK_ID,
  adrAggregateId, gateAggregateId, itemAggregateId, productAggregateId,
} from './scope.js';
```
(c) Add the schema (after `GateDecided` ~line 71), the payload type (after line 80), and the constructor (after `gateDecided` ~line 122):
```ts
const AdrReserved = z.object({
  adrNumber: z.number().int().positive(), itemId: z.string().min(1), repo: z.string().min(1),
});
```
```ts
export type AdrReservedPayload = z.infer<typeof AdrReserved>;
```
```ts
/** ADR-number reservation — a decompose-time allocator act (mirrors itemQueued's actor). */
export const adrReserved = (i: z.input<typeof AdrReserved> & { ts: string }) =>
  envelope(EVENT.ADR_RESERVED, 'Adr', adrAggregateId(i.repo, i.adrNumber), i.ts, AdrReserved.parse(i), 'foundry:queue');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/events.test.ts -t adrReserved`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/events.ts test/events.test.ts
git commit -m "feat(foundry): AdrReserved.v1 event + constructor"
```

---

### Task 3: Fold `ADR_RESERVED` into `DerivedState` + helpers

**Files:**
- Modify: `src/state.ts` (DerivedState ~60-64; fold init ~103-107; a new case ~after 220; helpers ~after 253)
- Test: `test/state.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/state.test.ts`:

```ts
import { adrReserved } from '../src/events.js';
import { adrKey, fold, maxReservedAdr, adrReservationForItem } from '../src/state.js';

describe('AdrReserved fold', () => {
  const ts = '2026-06-13T12:00:00.000Z';
  it('records reservations, maxReservedAdr is per-repo, item lookup works', () => {
    const s = fold([
      adrReserved({ adrNumber: 229, itemId: 'onc/ADR-229', repo: 'specs', ts }),
      adrReserved({ adrNumber: 230, itemId: 'onc/ADR-230', repo: 'specs', ts }),
      adrReserved({ adrNumber: 5, itemId: 'h/ADR-5', repo: 'health', ts }),
    ]);
    expect(s.adrs.get(adrKey('specs', 229))?.itemId).toBe('onc/ADR-229');
    expect(maxReservedAdr(s, 'specs')).toBe(230);
    expect(maxReservedAdr(s, 'health')).toBe(5);
    expect(maxReservedAdr(s, 'other')).toBe(0);
    expect(adrReservationForItem(s, 'onc/ADR-230')?.adrNumber).toBe(230);
    expect(adrReservationForItem(s, 'nope')).toBeUndefined();
  });
  it('a reservation is immutable (first-writer-wins)', () => {
    const s = fold([
      adrReserved({ adrNumber: 229, itemId: 'first', repo: 'specs', ts }),
      adrReserved({ adrNumber: 229, itemId: 'second', repo: 'specs', ts }),
    ]);
    expect(s.adrs.get(adrKey('specs', 229))?.itemId).toBe('first');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/state.test.ts -t "AdrReserved fold"`
Expected: FAIL — `s.adrs` undefined / helpers not exported.

- [ ] **Step 3: Implement** — four edits in `src/state.ts`:

(a) Add the interface + extend `DerivedState` (after `GateState`/before `DerivedState`, ~line 59):
```ts
export interface AdrReservationState {
  adrNumber: number;
  repo: string;
  itemId: string;
  reservedAt: string;
}
```
extend `DerivedState` (add to the interface ~60-64):
```ts
  adrs: Map<string, AdrReservationState>;
```
(b) Init it in `fold` (the `const s: DerivedState = {...}` ~103-107):
```ts
    adrs: new Map(),
```
(c) Add the fold case (after the `GATE_DECIDED` case, before `default:` ~line 220):
```ts
      case EVENT.ADR_RESERVED: {
        const repo = str(p['repo']);
        const adrNumber = p['adrNumber'] as number;
        const key = adrKey(repo, adrNumber);
        // First-writer-wins: a reservation is immutable once recorded (mirrors the
        // gate-decision idempotency guard). ops.reserveAdr is the gate; the fold echoes it.
        if (!s.adrs.has(key)) {
          s.adrs.set(key, { adrNumber, repo, itemId: str(p['itemId']), reservedAt: e.occurredAt });
        }
        break;
      }
```
(d) Add the helpers (after `depsSatisfied` ~line 253):
```ts
export const adrKey = (repo: string, adrNumber: number): string => `${repo}#${adrNumber}`;

/** Highest ADR number the log has reserved for a repo (0 if none). */
export function maxReservedAdr(s: DerivedState, repo: string): number {
  let max = 0;
  for (const r of s.adrs.values()) if (r.repo === repo && r.adrNumber > max) max = r.adrNumber;
  return max;
}

/** The reservation bound to an item, if any (item-attribution lookup). */
export function adrReservationForItem(s: DerivedState, itemId: string): AdrReservationState | undefined {
  for (const r of s.adrs.values()) if (r.itemId === itemId) return r;
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/state.test.ts -t "AdrReserved fold"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts test/state.test.ts
git commit -m "feat(foundry): fold AdrReserved into DerivedState.adrs + allocator helpers"
```

---

### Task 4: `reserveAdr` op (atomic allocation under the store-lock)

**Files:**
- Modify: `src/ops.ts` (state import ~9-13; new op after `queuePush` ~57)
- Test: `test/ops-adr-reserve.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `test/ops-adr-reserve.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { append } from '../src/log.js';
import { adrReserved } from '../src/events.js';
import { reserveAdr, type FoundryDeps } from '../src/ops.js';

const T0 = '2026-06-13T12:00:00.000Z';
function testDeps(): FoundryDeps {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-adr-'));
  return { dataDir: dir, logPath: join(dir, 'events.jsonl'), now: () => T0 };
}
const SPECS = 'de-braighter/specs';

describe('reserveAdr', () => {
  it('allocates the floor when the log has no reservations', () => {
    const deps = testDeps();
    expect(reserveAdr(deps, { itemId: 'a', repo: SPECS, floor: 230 }))
      .toEqual({ adrNumber: 230, itemId: 'a', repo: SPECS });
  });
  it('two sequential reservations are contiguous (no collision)', () => {
    const deps = testDeps();
    expect(reserveAdr(deps, { itemId: 'a', repo: SPECS, floor: 230 }).adrNumber).toBe(230);
    expect(reserveAdr(deps, { itemId: 'b', repo: SPECS, floor: 230 }).adrNumber).toBe(231);
  });
  it('maxReserved+1 wins when it exceeds the floor', () => {
    const deps = testDeps();
    append(adrReserved({ adrNumber: 240, itemId: 'pre', repo: SPECS, ts: T0 }), deps.logPath);
    expect(reserveAdr(deps, { itemId: 'a', repo: SPECS, floor: 230 }).adrNumber).toBe(241);
  });
  it('repos have independent sequences', () => {
    const deps = testDeps();
    reserveAdr(deps, { itemId: 'a', repo: SPECS, floor: 230 });
    expect(reserveAdr(deps, { itemId: 'b', repo: 'de-braighter/health', floor: 1 }).adrNumber).toBe(1);
  });
  it('rejects a second reservation for the same itemId', () => {
    const deps = testDeps();
    reserveAdr(deps, { itemId: 'a', repo: SPECS, floor: 230 });
    expect(() => reserveAdr(deps, { itemId: 'a', repo: SPECS, floor: 230 }))
      .toThrow(/item a already has ADR-230 reserved/);
  });
  it('defaults floor to 1 when omitted', () => {
    const deps = testDeps();
    expect(reserveAdr(deps, { itemId: 'a', repo: SPECS }).adrNumber).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ops-adr-reserve.test.ts`
Expected: FAIL — `reserveAdr` not exported.

- [ ] **Step 3: Implement** — two edits in `src/ops.ts`:

(a) Extend the `./state.js` import (lines 9-13) to add `maxReservedAdr, adrReservationForItem`:
```ts
import {
  activeClaim, adrReservationForItem, claimableItems, claimEnded, claimExpired, findClaim, fold,
  itemDone, itemStatus, maxReservedAdr, scopesDisjoint,
  type ClaimState, type DerivedState, type ItemState,
} from './state.js';
```
(b) Add the op right after `queuePush` (after line 57):
```ts
export interface ReserveAdrInput { itemId: string; repo: string; floor?: number }

/** Atomically allocate the next free ADR number for a repo and bind it to an item.
 *  Collision-proof: runs under the same store-lock as claim(), so two concurrent
 *  reservations serialize — the bug class behind the O-1/O-6.1 ADR-227 race.
 *  `floor` = the repo's current next-free-adr high-water mark (the log can't see
 *  ADRs authored outside the foundry, so the caller seeds the floor). */
export function reserveAdr(deps: FoundryDeps, input: ReserveAdrInput): { adrNumber: number; itemId: string; repo: string } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const s = load(deps);
    const existing = adrReservationForItem(s, input.itemId);
    if (existing) {
      throw new Error(`item ${input.itemId} already has ADR-${existing.adrNumber} reserved (${existing.repo})`);
    }
    const floor = input.floor ?? 1;
    const adrNumber = Math.max(floor, maxReservedAdr(s, input.repo) + 1);
    append(ev.adrReserved({ adrNumber, itemId: input.itemId, repo: input.repo, ts }), deps.logPath);
    return { adrNumber, itemId: input.itemId, repo: input.repo };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ops-adr-reserve.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ops.ts test/ops-adr-reserve.test.ts
git commit -m "feat(foundry): reserveAdr op — atomic collision-proof ADR allocation"
```

---

### Task 5: Expose `foundry_reserve_adr` MCP tool

**Files:**
- Modify: `src/mcp/tools.ts` (the `makeTools` return ~40-51)
- Modify: `src/mcp/server.ts` (register after `foundry_queue_push` ~78)
- Test: `test/mcp-tools.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/mcp-tools.test.ts`:

```ts
// (reuse the file's existing temp-dir makeTools harness; if it defines a helper,
//  call it — otherwise construct makeTools({dataDir, logPath}) over a mkdtemp dir.)
describe('foundry_reserve_adr tool', () => {
  it('returns the reserved number and isError on a double-reserve', async () => {
    const tools = makeTools(freshDeps());
    const r1 = await tools.foundry_reserve_adr({ itemId: 'a', repo: 'de-braighter/specs', floor: 230 });
    expect(r1.isError).toBeFalsy();
    expect(r1.content[0].text).toContain('"adrNumber": 230');
    const r2 = await tools.foundry_reserve_adr({ itemId: 'a', repo: 'de-braighter/specs', floor: 230 });
    expect(r2.isError).toBe(true);
    expect(r2.content[0].text).toContain('already has ADR-230');
  });
});
```
*(Match `makeTools`/`freshDeps` to the harness already in `test/mcp-tools.test.ts`; if none, construct `makeTools({ dataDir: mkdtempSync(...), logPath: join(dir,'events.jsonl'), now: () => '2026-06-13T12:00:00.000Z' })`.)*

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp-tools.test.ts -t foundry_reserve_adr`
Expected: FAIL — `tools.foundry_reserve_adr` is not a function.

- [ ] **Step 3: Implement** — two edits:

(a) `src/mcp/tools.ts` — add to the `makeTools` return object (after `foundry_gate_decide` line 50):
```ts
    foundry_reserve_adr: guard((a: ops.ReserveAdrInput) => ops.reserveAdr(deps, a)),
```
(b) `src/mcp/server.ts` — register after the `foundry_queue_push` block (after line 78):
```ts
  server.registerTool('foundry_reserve_adr', {
    description: 'Reserve the next free ADR number for a work item, atomically (collision-proof under the store-lock). Pass the target repo and floor (the repo\'s current next-free-adr). Binds adrNumber -> itemId; an item may reserve only once. Build-path calls this at decompose-time so parallel workers never pick the same number.',
    inputSchema: { itemId: z.string().min(1), repo: z.string().min(1), floor: z.number().int().positive().optional() },
  }, async (a) => tools.foundry_reserve_adr(a));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp-tools.test.ts -t foundry_reserve_adr`
Expected: PASS.

- [ ] **Step 5: Run the full repo gate**

Run: `npm run ci:local`
Expected: typecheck clean + all tests pass + coverage holds (the new branches are covered by Tasks 1-5).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts src/mcp/server.ts test/mcp-tools.test.ts
git commit -m "feat(foundry): foundry_reserve_adr MCP tool"
```

---

### Task 6: `/build-path` — reserve numbers + emit ADR-authoring items (workbench)

**Files:**
- Modify: `.claude/skills/build-path/SKILL.md` (Procedure step 5 ADR-needs ~94-97; step 7 decompose ~102-107; step 8 disjointness ~108-116)

- [ ] **Step 1: Rewrite step 5 (ADR needs → reserve + emit).** Replace the prose-only "List the ADRs" step with: for each ADR the path requires, (a) read the target repo's current `next-free-adr` from `<repo>/adr/README.md` (specs) as the `floor`; (b) call `foundry_reserve_adr { itemId: '<key>/ADR-<n>', repo: '<adr-repo>', floor }` to get the allocated number `<n>`; (c) emit a dedicated **ADR-authoring item** `<key>/ADR-<n>` (title = the ADR's decision + "designer-first ADR authoring; consumes reserved ADR-<n>"), scoped `{ repo: '<adr-repo>', pathPrefix: 'adr/adr-<n>-' }` (or the specs adr dir), carrying the product's designer-first/founder-gate obligations.

- [ ] **Step 2: Update step 7 (dependsOn edges).** Every code item that cites the ADR lists `<key>/ADR-<n>` in its `dependsOn`. State the rule: the MINIMAL set of code items that genuinely depend on each ADR (over-broad dependsOn serializes the fan-out).

- [ ] **Step 3: Update step 8 (disjointness proof).** Add ADR-authoring items to the unordered-pair table: an `<key>/ADR-<n>` item in the specs repo is `different repo` from product-repo code items → disjoint by rule 1; if co-located in the product repo, prove non-nested path. Extend the dangling-`dependsOn` check to assert every `<key>/ADR-<n>` referenced by a code item appears in the item list.

- [ ] **Step 4: Verify the skill reads coherently** (no contradictions with the foundry tool surface; the reserve call precedes `foundry_queue_push`).

Run: `npx markdownlint-cli2 .claude/skills/build-path/SKILL.md` (if wired) or a manual read.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/build-path/SKILL.md
git commit -m "feat(build-path): reserve ADR numbers + emit ADR-authoring items (foundry ADR-coordination)"
```

---

### Task 7: `/foundry-worker` — designer-first consumes the reserved number (workbench)

**Files:**
- Modify: `.claude/skills/foundry-worker/SKILL.md` (Phase 3 EXECUTE / designer-first route ~128-130)

- [ ] **Step 1: Add to the designer-first route note:** when the claimed item is (or carries) a reserved ADR — its itemId is `<key>/ADR-<n>`, or `foundry_status`/the binding names a reserved `ADR-<n>` for it — the worker **uses that number** for the ADR file and PR title; it does **NOT** read/allocate from `next-free-adr`. The PR title is generated from the binding (`ADR-<n> … (<productKey> <itemId>)`), which is what prevents the O-4→"O-2" mislabel.

- [ ] **Step 2: Verify coherence** with the existing Phase 3 routing table + Phase 4 (designer-first evidence in the PR).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/foundry-worker/SKILL.md
git commit -m "feat(foundry-worker): designer-first consumes the reserved ADR number (no next-free-adr race)"
```

---

### Task 8: Land — spec + plan commit, PRs, verifier wave

- [ ] **Step 1: Commit the design spec + this plan** (workbench branch):

```bash
git add docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md \
        docs/superpowers/plans/2026-06-13-foundry-adr-coordination-slice1.md
git commit -m "docs(foundry): autonomous-foundry conductor design + ADR-coordination slice-1 plan"
```

- [ ] **Step 2: Open PR-A (`domains/foundry`)** — push the foundry branch, open the PR with `Producer:`/`Effort:`/`Effect:` lines; run the **verifier wave** (reviewer + qa-engineer + charter-checker, isolation worktree); post findings before any fix commit.

- [ ] **Step 3: Open PR-B (workbench)** — the skill edits + spec + plan; same PR ritual.

- [ ] **Step 4: Gate + merge per tier** — the foundry is internal infra (T0-equivalent for its own dev): green wave + `ci:local` → squash-merge. Run the twin ritual (drain → backfill → reconcile).

---

## Self-Review

**Spec coverage (§4 Component A):** ✓ AdrReserved event (Task 2), reserveAdr under store-lock (Task 4), AdrReservation aggregate (Task 3), adrAggregateId (Task 1), floor-seed (Task 4 + Task 6 step 1), binding-on-aggregate-not-WorkItem (Task 3 — WorkItem untouched). **§5 Component B:** ✓ build-path emits ADR items + dependsOn (Task 6), worker consumes reserved number (Task 7), disjointness proof extended (Task 6 step 3). **Refinement noted:** spec §A.1 said "inside queuePush's lock"; this plan uses a **standalone `reserveAdr`** under the same lock (equally atomic; cleaner/composable) — update spec §A.1's wording on commit.

**Placeholder scan:** none — every code step has complete code; Task 5 step 1 + Task 6/7 reference real files + the precise edits (the skill edits are prose-instruction changes, shown as the exact rewrite intent).

**Type consistency:** `reserveAdr`/`ReserveAdrInput`/`adrReserved`/`adrAggregateId(repo, n)`/`adrKey(repo, n)`/`maxReservedAdr(s, repo)`/`adrReservationForItem(s, itemId)`/`AdrReservationState`/`DerivedState.adrs`/`EVENT.ADR_RESERVED` are used identically across Tasks 1-5. Constructor input `{ adrNumber, itemId, repo, ts }` matches the schema and the op's `append(ev.adrReserved({...}))` call.
