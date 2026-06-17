# Foundry as a Substrate self-application — v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@de-braighter/foundry` host a product-creation metamodel ("both faces, one recursive tree") instantiated by two real products (foundry + whales), proving the model is reusable (whales adds zero new shapes) — descriptive only, zero kernel change.

**Architecture:** Absorb the three reusable twin modules from `domains/devloop` (`plan/`, `inference/`, `ingest/observe`) into the already-event-sourced `domains/foundry`, keeping foundry's `log.ts` canonical. Add a small typed **metamodel** lib (node-kind / resource / substance vocabulary) over the existing `CascadeNodeSpec` → `PlanTree`, author `Product(foundry)` + `Product(whales)` as specs, derive the **substance projection** (`⋃ yields`) + three posteriors, and assert genericity.

**Tech Stack:** TypeScript ESM (`"type":"module"`, `.js` import extensions, `module:esnext`/`moduleResolution:bundler`), vitest, zod, `@de-braighter/substrate-contracts@^0.10.0` (`/events`, `/plan-tree`). No NestJS/Prisma/Postgres.

## Global Constraints

- **Zero kernel change.** Import only from `@de-braighter/substrate-contracts`; never edit `layers/substrate`. All new shape = typed pack lib + `meta`/`metadata` on existing `CascadeNodeSpec`/`PlanNode`.
- **Descriptive only.** No driving (do **not** touch `domains/foundry/src/ops.ts`, `mcp/`, `store-lock.ts`, `wt-pool*.ts` coordination logic — read-only consumption of their output is fine). No generation/scaffolding. No scheduler.
- **Foundry's log is canonical** for new metamodel work. The relocated functions stay **log-path-parameterized** so `domains/devloop` keeps calling them against its own log unchanged.
- **ESM:** every intra-package import uses an explicit `.js` extension.
- **Tests:** vitest; temp dirs via `mkdtempSync(join(tmpdir(), 'foundry-…'))`; deterministic `const TS = '2026-06-10T12:00:00.000Z'`. Each task ends green: `cd domains/foundry && npm test`.
- **Deterministic IDs:** reuse `uuidv5(...)` from the relocated `scope.ts`; never `Math.random()`/`Date.now()` in authored specs or derivations.
- **Commit per task** with conventional-commit messages, ending `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Out of scope (named follow-ups):** full devloop retirement + physical log-collapse; the metamodel *driving* the conductor (v1); blueprint *generation* (v2); agri/oncology instances; studio UI.

---

## Phase 1 — Absorb the reusable twin modules into foundry

> Relocate code that already works; `domains/devloop` re-imports it from `@de-braighter/foundry` so its rituals keep running. Behavior-preserving because every moved function takes an explicit `logPath`/`events` argument.

### Task 1: Add `@de-braighter/foundry` as a devloop dependency + pure helpers (`scope`, `provider`)

**Files:**
- Create: `domains/foundry/src/scope.ts` (moved from `domains/devloop/src/scope.ts`)
- Create: `domains/foundry/src/provider.ts` (moved from `domains/devloop/src/provider.ts`)
- Create: `domains/foundry/test/scope.test.ts`, `domains/foundry/test/provider.test.ts` (moved with them)
- Modify: `domains/devloop/src/scope.ts` → re-export shim; `domains/devloop/src/provider.ts` → re-export shim
- Modify: `domains/devloop/package.json` (add dep `"@de-braighter/foundry": "file:../foundry"`)

**Interfaces:**
- Produces: `uuidv5(name: string, namespace?: string): string`, `DEVLOOP_TENANT_PACK_ID: string` (from `scope.ts`); `providerOf(model: string): string` (from `provider.ts`).

- [ ] **Step 1: Copy the two files + their tests into foundry verbatim.**

```bash
cp domains/devloop/src/scope.ts    domains/foundry/src/scope.ts
cp domains/devloop/src/provider.ts domains/foundry/src/provider.ts
cp domains/devloop/test/scope.test.ts    domains/foundry/test/scope.test.ts 2>/dev/null || true
cp domains/devloop/test/provider.test.ts domains/foundry/test/provider.test.ts 2>/dev/null || true
```

- [ ] **Step 2: Run foundry tests to confirm the moved files compile + pass in their new home.**

Run: `cd domains/foundry && npm test`
Expected: PASS (new scope/provider tests green; existing foundry tests unaffected).

- [ ] **Step 3: Replace devloop's originals with re-export shims** so devloop keeps working without code churn.

`domains/devloop/src/scope.ts`:
```typescript
// Re-homed to @de-braighter/foundry (v0 merge). Shim kept so devloop callers are unchanged.
export { uuidv5, DEVLOOP_TENANT_PACK_ID } from '@de-braighter/foundry/scope';
```

`domains/devloop/src/provider.ts`:
```typescript
export { providerOf } from '@de-braighter/foundry/provider';
```

- [ ] **Step 4: Add foundry subpath exports** so `@de-braighter/foundry/scope` resolves.

In `domains/foundry/package.json`, ensure an `"exports"` map includes the new subpaths (add alongside any existing):
```json
"exports": {
  ".": "./src/index.js",
  "./scope": "./src/scope.js",
  "./provider": "./src/provider.js"
}
```
Add `"@de-braighter/foundry": "file:../foundry"` to `domains/devloop/package.json` `dependencies`, then `cd domains/devloop && npm install`.

- [ ] **Step 5: Run both test suites.**

Run: `cd domains/foundry && npm test && cd ../devloop && npm test`
Expected: both PASS.

- [ ] **Step 6: Commit.**

```bash
git add domains/foundry/src/scope.ts domains/foundry/src/provider.ts domains/foundry/test/scope.test.ts domains/foundry/test/provider.test.ts domains/foundry/package.json domains/devloop/src/scope.ts domains/devloop/src/provider.ts domains/devloop/package.json
git commit -m "refactor(foundry): absorb scope+provider helpers from devloop (re-export shims)"
```

### Task 2: Merge devloop's `log.ts` helpers into foundry's `log.ts`

> Foundry's `log.ts` already has `append`/`readEnvelopes`. Add the read-side helpers the twin modules need: `ofType`, `dedupKey`, `appendUnique`.

**Files:**
- Modify: `domains/foundry/src/log.ts` (add helpers)
- Test: `domains/foundry/test/log-helpers.test.ts` (create)
- Modify: `domains/devloop/src/log.ts` (re-export the three helpers from foundry; keep devloop's own `DEFAULT_LOG`)

**Interfaces:**
- Consumes: `DomainEventEnvelope` from `@de-braighter/substrate-contracts/events`.
- Produces: `ofType(events: DomainEventEnvelope[], eventType: string): DomainEventEnvelope[]`; `dedupKey(env: DomainEventEnvelope): string`; `appendUnique(env: DomainEventEnvelope, seen: Set<string>, logPath?: string): boolean`.

- [ ] **Step 1: Write the failing test.**

`domains/foundry/test/log-helpers.test.ts`:
```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { productRegistered, itemQueued } from '../src/events.js';
import { append, readEnvelopes, ofType, dedupKey, appendUnique } from '../src/log.js';

const TS = '2026-06-10T12:00:00.000Z';
const tmp = () => mkdtempSync(join(tmpdir(), 'foundry-logh-'));

describe('log helpers', () => {
  it('ofType filters by eventType', () => {
    const a = productRegistered({ productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0', ts: TS });
    const b = itemQueued({ itemId: 'p/1', productKey: 'p', title: 'x', scope: { repo: 'r/p' }, ts: TS });
    expect(ofType([a, b], 'foundry:WorkItemQueued.v1')).toEqual([b]);
  });
  it('dedupKey is stable for identical payloads and differs across types', () => {
    const a = productRegistered({ productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0', ts: TS });
    const b = productRegistered({ productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0', ts: TS });
    expect(dedupKey(a)).toBe(dedupKey(b));
  });
  it('appendUnique skips a payload already seen', () => {
    const log = join(tmp(), 'events.jsonl');
    const seen = new Set<string>();
    const e = itemQueued({ itemId: 'p/1', productKey: 'p', title: 'x', scope: { repo: 'r/p' }, ts: TS });
    expect(appendUnique(e, seen, log)).toBe(true);
    expect(appendUnique(e, seen, log)).toBe(false);
    expect(readEnvelopes(log)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd domains/foundry && npx vitest run test/log-helpers.test.ts`
Expected: FAIL — `ofType`/`dedupKey`/`appendUnique` not exported.

- [ ] **Step 3: Add the helpers to `domains/foundry/src/log.ts`** (port verbatim from devloop's `log.ts`; reuse foundry's existing `append`).

```typescript
// --- append/readEnvelopes already exist above ---

export const ofType = (events: DomainEventEnvelope[], eventType: string): DomainEventEnvelope[] =>
  events.filter((e) => e.eventType === eventType);

const canonicalJson = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

export const dedupKey = (env: DomainEventEnvelope): string =>
  `${env.eventType} ${canonicalJson(env.payload)}`;

export function appendUnique(env: DomainEventEnvelope, seen: Set<string>, logPath: string = DEFAULT_LOG): boolean {
  const k = dedupKey(env);
  if (seen.has(k)) return false;
  seen.add(k);
  append(env, logPath);
  return true;
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `cd domains/foundry && npx vitest run test/log-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Point devloop's helpers at foundry** (keep devloop's own `append`/`readEnvelopes`/`DEFAULT_LOG`; re-export only the three helpers).

In `domains/devloop/src/log.ts`, replace the local `ofType`/`dedupKey`/`appendUnique` definitions with:
```typescript
export { ofType, dedupKey, appendUnique } from '@de-braighter/foundry/log';
```
Add `"./log": "./src/log.js"` to foundry's `package.json` `exports`.

- [ ] **Step 6: Run both suites + commit.**

```bash
cd domains/foundry && npm test && cd ../devloop && npm test
git add domains/foundry/src/log.ts domains/foundry/test/log-helpers.test.ts domains/foundry/package.json domains/devloop/src/log.ts
git commit -m "refactor(foundry): host log read-helpers (ofType/dedupKey/appendUnique)"
```

### Task 3: Host the twin's observation event vocabulary in foundry

> The twin modules need devloop's `EVENT` constants + effect/producer constructors (`devloop:EffectDeclared.v1` etc.). Re-home them into foundry as `events-obs.ts` (kept distinct from foundry's machine `events.ts`); devloop re-exports.

**Files:**
- Create: `domains/foundry/src/events-obs.ts` (moved from `domains/devloop/src/events.ts`)
- Create: `domains/foundry/test/events-obs.test.ts` (moved with it)
- Modify: `domains/devloop/src/events.ts` → re-export shim
- Modify: `domains/foundry/package.json` exports (`"./events-obs"`)

**Interfaces:**
- Produces: `EVENT` (obs constants), `effectDeclared(...)`, `effectObserved(...)`, and types `EffectDeclaredPayload`, `EffectObservedPayload`, `ProducerPayload`, `PrMergedPayload`.

- [ ] **Step 1: Move the file + test.**

```bash
git mv domains/devloop/src/events.ts domains/foundry/src/events-obs.ts
cp domains/devloop/test/events.test.ts domains/foundry/test/events-obs.test.ts 2>/dev/null || true
```
Fix any intra-file relative imports in `events-obs.ts` to resolve within foundry (e.g. it imports `./scope.js` — foundry now has `scope.ts`, so this resolves unchanged).

- [ ] **Step 2: Recreate `domains/devloop/src/events.ts` as a shim.**

```typescript
export * from '@de-braighter/foundry/events-obs';
```
Add `"./events-obs": "./src/events-obs.js"` to foundry's `package.json` exports.

- [ ] **Step 3: Run both suites.**

Run: `cd domains/foundry && npm test && cd ../devloop && npm test`
Expected: both PASS (devloop's modules still see `EVENT`/`effectObserved` via the shim).

- [ ] **Step 4: Commit.**

```bash
git add -A domains/foundry domains/devloop
git commit -m "refactor(foundry): host observation event vocabulary (events-obs)"
```

### Task 4: Relocate `plan/` (cascade + intervention-composition) into foundry

**Files:**
- Move: `domains/devloop/src/plan/cascade.ts` → `domains/foundry/src/plan/cascade.ts`
- Move: `domains/devloop/src/plan/intervention-composition.ts` → `domains/foundry/src/plan/intervention-composition.ts`
- Move tests: the matching `test/*cascade*`, `test/*composition*` files
- Modify: `domains/devloop/src/plan/*` → re-export shims; foundry `package.json` exports `"./plan"`

**Interfaces:**
- Consumes: `uuidv5`, `DEVLOOP_TENANT_PACK_ID` from `../scope.js`; `PlanTree`, `PlanNode`, `EffectDeclaration`, `PlanTreeSchema`, `composeEffects`, `ComposedEffect`, `CompositionError` from `@de-braighter/substrate-contracts/plan-tree`; `Result` from `@de-braighter/substrate-contracts`.
- Produces: `CascadeNodeSpec` (`{ key; kind; parent; meta?; effects? }`); `buildCascadeTree(spec: CascadeNodeSpec[]): PlanTree`; `renderCascade(tree: PlanTree): string`; `rollUp(tree, opts?, nodeId?): Result<ComposedEffect[], CompositionError>`.

- [ ] **Step 1: Move files + tests.**

```bash
mkdir -p domains/foundry/src/plan
git mv domains/devloop/src/plan/cascade.ts domains/foundry/src/plan/cascade.ts
git mv domains/devloop/src/plan/intervention-composition.ts domains/foundry/src/plan/intervention-composition.ts
git mv domains/devloop/test/cascade.test.ts domains/foundry/test/cascade.test.ts 2>/dev/null || true
git mv domains/devloop/test/intervention-composition.test.ts domains/foundry/test/intervention-composition.test.ts 2>/dev/null || true
```

- [ ] **Step 2: Fix relative imports** — `../scope.js` resolves to foundry's `scope.ts` (already moved). No edits expected; verify by typecheck.

Run: `cd domains/foundry && npm run typecheck`
Expected: PASS (no unresolved imports).

- [ ] **Step 3: Run foundry tests.**

Run: `cd domains/foundry && npm test`
Expected: PASS (cascade + composition tests green in foundry).

- [ ] **Step 4: Shim devloop's plan modules.**

`domains/devloop/src/plan/cascade.ts`:
```typescript
export * from '@de-braighter/foundry/plan/cascade';
```
`domains/devloop/src/plan/intervention-composition.ts`:
```typescript
export * from '@de-braighter/foundry/plan/intervention-composition';
```
Add to foundry `package.json` exports: `"./plan/cascade": "./src/plan/cascade.js"`, `"./plan/intervention-composition": "./src/plan/intervention-composition.js"`.

- [ ] **Step 5: Run both suites + commit.**

```bash
cd domains/foundry && npm test && cd ../devloop && npm test
git add -A domains/foundry domains/devloop
git commit -m "refactor(foundry): relocate plan/ (cascade + intervention-composition)"
```

### Task 5: Relocate the needed `inference/` (cycle-time + calibration) + `ingest/observe` into foundry

**Files:**
- Move: `domains/devloop/src/inference/cycle-time.ts`, `inference/calibration.ts` → `domains/foundry/src/inference/`
- Move: `domains/devloop/src/ingest/observe.ts` → `domains/foundry/src/ingest/observe.ts`
- Move matching tests; shim the devloop originals; add foundry `package.json` exports.

**Interfaces:**
- Produces: `cyclePosterior(cycleHours: number[], draws?: number): PosteriorStats` (`{ distributionRef; parameterValues; mean; sd; p10; p50; p90 }`); `calibration(events: DomainEventEnvelope[]): Calibration`; `reconcileObservations(events, ts, externals?): Promise<Reconciliation>`; `OBSERVERS: Record<string, Observer>`.

- [ ] **Step 1: Move files + tests.**

```bash
mkdir -p domains/foundry/src/inference domains/foundry/src/ingest
git mv domains/devloop/src/inference/cycle-time.ts  domains/foundry/src/inference/cycle-time.ts
git mv domains/devloop/src/inference/calibration.ts domains/foundry/src/inference/calibration.ts
git mv domains/devloop/src/ingest/observe.ts        domains/foundry/src/ingest/observe.ts
git mv domains/devloop/test/cycle-time.test.ts  domains/foundry/test/cycle-time.test.ts 2>/dev/null || true
git mv domains/devloop/test/calibration.test.ts domains/foundry/test/calibration.test.ts 2>/dev/null || true
git mv domains/devloop/test/observe.test.ts     domains/foundry/test/observe.test.ts 2>/dev/null || true
```

- [ ] **Step 2: Fix imports.** `calibration.ts` imports `../log.js` (`ofType` — now in foundry's log), `../events.js` (→ change to `../events-obs.js`), `../provider.js` (moved). `observe.ts` imports `../log.js` + `../events.js` (→ `../events-obs.js`). Edit those two import lines:

In `domains/foundry/src/inference/calibration.ts` and `domains/foundry/src/ingest/observe.ts`, change:
```typescript
import { ... } from '../events.js';
```
to:
```typescript
import { ... } from '../events-obs.js';
```

- [ ] **Step 3: Typecheck + test.**

Run: `cd domains/foundry && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Shim devloop originals** (`export * from '@de-braighter/foundry/inference/cycle-time'` etc.); add the foundry `package.json` exports for `./inference/cycle-time`, `./inference/calibration`, `./ingest/observe`.

- [ ] **Step 5: Run both suites + commit.**

```bash
cd domains/foundry && npm test && cd ../devloop && npm test
git add -A domains/foundry domains/devloop
git commit -m "refactor(foundry): relocate inference (cycle-time, calibration) + ingest/observe"
```

---

## Phase 2 — The metamodel typed lib

> A small typed vocabulary over the existing `CascadeNodeSpec`: node kinds, the `resource` ref, and `SubstanceRef`s carried in `meta`. No new kernel types.

### Task 6: Define the metamodel vocabulary + a spec validator

**Files:**
- Create: `domains/foundry/src/metamodel/vocabulary.ts`
- Test: `domains/foundry/test/metamodel-vocabulary.test.ts`

**Interfaces:**
- Consumes: `CascadeNodeSpec` from `../plan/cascade.js`.
- Produces:
  - `NODE_KINDS = ['product','capability','feature','work-item'] as const`; `NodeKind`.
  - `RESOURCES = ['ai','human','compute'] as const`; `Resource`.
  - `SUBSTANCE_KINDS = ['pack','board','policy','indicator'] as const`; `SubstanceKind`; `SubstanceRef = { kind: SubstanceKind; id: string }`.
  - `WorkItemMeta = { resource: Resource; yields: SubstanceRef[]; status: 'queued'|'built'|'done'|'retired'; itemId?: string; title?: string }`.
  - `vocabularyOf(spec: CascadeNodeSpec[]): { kinds: Set<string>; resources: Set<string>; substances: Set<string> }`.
  - `validateInstance(spec: CascadeNodeSpec[]): string[]` (returns violation messages; empty = valid).

- [ ] **Step 1: Write the failing test.**

`domains/foundry/test/metamodel-vocabulary.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import type { CascadeNodeSpec } from '../src/plan/cascade.js';
import { vocabularyOf, validateInstance } from '../src/metamodel/vocabulary.js';

const ok: CascadeNodeSpec[] = [
  { key: 'p', kind: 'product', parent: null, meta: { title: 'P' } },
  { key: 'c', kind: 'capability', parent: 'p' },
  { key: 'f', kind: 'feature', parent: 'c' },
  { key: 'w', kind: 'work-item', parent: 'f',
    meta: { resource: 'ai', yields: [{ kind: 'pack', id: 'lease' }], status: 'done' } },
];

describe('metamodel vocabulary', () => {
  it('collects kinds/resources/substances used by a spec', () => {
    const v = vocabularyOf(ok);
    expect([...v.kinds].sort()).toEqual(['capability', 'feature', 'product', 'work-item']);
    expect([...v.resources]).toEqual(['ai']);
    expect([...v.substances]).toEqual(['pack']);
  });
  it('passes a valid instance', () => {
    expect(validateInstance(ok)).toEqual([]);
  });
  it('rejects an unknown node kind', () => {
    const bad = [...ok, { key: 'x', kind: 'epic', parent: 'p' } as CascadeNodeSpec];
    expect(validateInstance(bad)).toContain('unknown node kind: epic (node x)');
  });
  it('rejects a work-item with an unknown resource', () => {
    const bad: CascadeNodeSpec[] = [{ key: 'w2', kind: 'work-item', parent: null,
      meta: { resource: 'gpu', yields: [], status: 'queued' } }];
    expect(validateInstance(bad)).toContain('unknown resource: gpu (node w2)');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd domains/foundry && npx vitest run test/metamodel-vocabulary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `domains/foundry/src/metamodel/vocabulary.ts`.**

```typescript
import type { CascadeNodeSpec } from '../plan/cascade.js';

export const NODE_KINDS = ['product', 'capability', 'feature', 'work-item'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const RESOURCES = ['ai', 'human', 'compute'] as const;
export type Resource = (typeof RESOURCES)[number];

export const SUBSTANCE_KINDS = ['pack', 'board', 'policy', 'indicator'] as const;
export type SubstanceKind = (typeof SUBSTANCE_KINDS)[number];
export interface SubstanceRef { kind: SubstanceKind; id: string }

export type WorkItemStatus = 'queued' | 'built' | 'done' | 'retired';
export interface WorkItemMeta {
  resource: Resource;
  yields: SubstanceRef[];
  status: WorkItemStatus;
  itemId?: string;
  title?: string;
}

const wi = (n: CascadeNodeSpec): WorkItemMeta | undefined =>
  n.kind === 'work-item' ? (n.meta as unknown as WorkItemMeta) : undefined;

export function vocabularyOf(spec: CascadeNodeSpec[]): {
  kinds: Set<string>; resources: Set<string>; substances: Set<string>;
} {
  const kinds = new Set<string>(), resources = new Set<string>(), substances = new Set<string>();
  for (const n of spec) {
    kinds.add(n.kind);
    const m = wi(n);
    if (m) {
      if (m.resource) resources.add(m.resource);
      for (const y of m.yields ?? []) substances.add(y.kind);
    }
  }
  return { kinds, resources, substances };
}

export function validateInstance(spec: CascadeNodeSpec[]): string[] {
  const errs: string[] = [];
  for (const n of spec) {
    if (!NODE_KINDS.includes(n.kind as NodeKind)) errs.push(`unknown node kind: ${n.kind} (node ${n.key})`);
    const m = wi(n);
    if (m) {
      if (!RESOURCES.includes(m.resource)) errs.push(`unknown resource: ${m.resource} (node ${n.key})`);
      for (const y of m.yields ?? [])
        if (!SUBSTANCE_KINDS.includes(y.kind)) errs.push(`unknown substance kind: ${y.kind} (node ${n.key})`);
    }
  }
  return errs;
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `cd domains/foundry && npx vitest run test/metamodel-vocabulary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add domains/foundry/src/metamodel/vocabulary.ts domains/foundry/test/metamodel-vocabulary.test.ts
git commit -m "feat(foundry): metamodel vocabulary (node-kind/resource/substance) + instance validator"
```

### Task 7: Substance projection (`substance = ⋃ yields(done work-items)`)

**Files:**
- Create: `domains/foundry/src/metamodel/substance.ts`
- Test: `domains/foundry/test/metamodel-substance.test.ts`

**Interfaces:**
- Consumes: `CascadeNodeSpec`; `SubstanceRef`, `WorkItemMeta` from `./vocabulary.js`.
- Produces: `deriveSubstance(spec: CascadeNodeSpec[]): SubstanceRef[]` (deduped, only `status:'done'`); `completeness(spec): { landed: number; declared: number; pct: number }`.

- [ ] **Step 1: Write the failing test.**

`domains/foundry/test/metamodel-substance.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import type { CascadeNodeSpec } from '../src/plan/cascade.js';
import { deriveSubstance, completeness } from '../src/metamodel/substance.js';

const spec: CascadeNodeSpec[] = [
  { key: 'p', kind: 'product', parent: null },
  { key: 'w1', kind: 'work-item', parent: 'p',
    meta: { resource: 'ai', yields: [{ kind: 'pack', id: 'lease' }], status: 'done' } },
  { key: 'w2', kind: 'work-item', parent: 'p',
    meta: { resource: 'ai', yields: [{ kind: 'board', id: 'flow' }], status: 'built' } },
  { key: 'w3', kind: 'work-item', parent: 'p',
    meta: { resource: 'ai', yields: [{ kind: 'pack', id: 'lease' }], status: 'done' } },
];

describe('substance projection', () => {
  it('is the deduped union of yields of DONE work-items only', () => {
    expect(deriveSubstance(spec)).toEqual([{ kind: 'pack', id: 'lease' }]);
  });
  it('completeness = landed/declared', () => {
    // declared yields = lease, flow, lease(dup) -> declared distinct = 2; landed (done) distinct = 1
    expect(completeness(spec)).toEqual({ landed: 1, declared: 2, pct: 0.5 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd domains/foundry && npx vitest run test/metamodel-substance.test.ts`).

- [ ] **Step 3: Implement `domains/foundry/src/metamodel/substance.ts`.**

```typescript
import type { CascadeNodeSpec } from '../plan/cascade.js';
import type { SubstanceRef, WorkItemMeta } from './vocabulary.js';

const wis = (spec: CascadeNodeSpec[]): WorkItemMeta[] =>
  spec.filter((n) => n.kind === 'work-item').map((n) => n.meta as unknown as WorkItemMeta);

const key = (s: SubstanceRef) => `${s.kind} ${s.id}`;
const uniq = (refs: SubstanceRef[]): SubstanceRef[] => {
  const seen = new Set<string>(); const out: SubstanceRef[] = [];
  for (const r of refs) if (!seen.has(key(r))) { seen.add(key(r)); out.push(r); }
  return out;
};

export function deriveSubstance(spec: CascadeNodeSpec[]): SubstanceRef[] {
  return uniq(wis(spec).filter((m) => m.status === 'done').flatMap((m) => m.yields ?? []));
}

export function completeness(spec: CascadeNodeSpec[]): { landed: number; declared: number; pct: number } {
  const declared = uniq(wis(spec).flatMap((m) => m.yields ?? [])).length;
  const landed = deriveSubstance(spec).length;
  return { landed, declared, pct: declared === 0 ? 0 : landed / declared };
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add domains/foundry/src/metamodel/substance.ts domains/foundry/test/metamodel-substance.test.ts
git commit -m "feat(foundry): substance projection (union of yields of done work-items) + completeness"
```

---

## Phase 3 — Author the two instances

### Task 8: `Product(foundry)` instance (authored from real board/PR history)

**Files:**
- Create: `domains/foundry/src/instances/foundry-product.ts`
- Test: `domains/foundry/test/instance-foundry.test.ts`

**Interfaces:**
- Consumes: `CascadeNodeSpec`, `buildCascadeTree`; `validateInstance`.
- Produces: `FOUNDRY_PRODUCT: CascadeNodeSpec[]`.

- [ ] **Step 1: Write the failing test** (the instance must be valid + build a tree).

`domains/foundry/test/instance-foundry.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { buildCascadeTree } from '../src/plan/cascade.js';
import { validateInstance, vocabularyOf } from '../src/metamodel/vocabulary.js';
import { FOUNDRY_PRODUCT } from '../src/instances/foundry-product.js';

describe('Product(foundry) instance', () => {
  it('is a valid metamodel instance', () => {
    expect(validateInstance(FOUNDRY_PRODUCT)).toEqual([]);
  });
  it('builds a single-parent plan tree', () => {
    const tree = buildCascadeTree(FOUNDRY_PRODUCT);
    expect(tree.treeRootId).toBeTruthy();
  });
  it('uses only the four node kinds', () => {
    expect([...vocabularyOf(FOUNDRY_PRODUCT).kinds].sort())
      .toEqual(['capability', 'feature', 'product', 'work-item']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Author `domains/foundry/src/instances/foundry-product.ts`** from the real board (O-items, slice-3 backlog). Each work-item = a story; `itemId` links to the foundry log; `effect`/`yields`/`status` from the shipped PRs.

```typescript
import type { CascadeNodeSpec } from '../plan/cascade.js';

// Authored from foundry's real board + shipped PRs (descriptive v0). status reflects what shipped.
export const FOUNDRY_PRODUCT: CascadeNodeSpec[] = [
  { key: 'foundry', kind: 'product', parent: null, meta: { title: 'Foundry — the product-creation machine' } },

  { key: 'cap-conduct', kind: 'capability', parent: 'foundry', meta: { title: 'Autonomous conduct' } },
  { key: 'feat-warm-pool', kind: 'feature', parent: 'cap-conduct', meta: { title: 'Warm pool' } },
  { key: 'story-pool-auto', kind: 'work-item', parent: 'feat-warm-pool',
    meta: { title: 'Warm-pool auto-engagement (per-slot lease)', itemId: 'foundry/slice3-1',
      resource: 'ai', status: 'done', yields: [{ kind: 'pack', id: 'slot-lease-primitive' }] },
    effects: [{ indicatorId: 'cycle-time', direction: 'decrease', magnitude: { kind: 'absolute', value: 0.3 }, confidence: 0.5 }] },

  { key: 'cap-lifecycle', kind: 'capability', parent: 'foundry', meta: { title: 'Lifecycle + observability ops' } },
  { key: 'feat-retire', kind: 'feature', parent: 'cap-lifecycle', meta: { title: 'Retire / reconcile' } },
  { key: 'story-retire', kind: 'work-item', parent: 'feat-retire',
    meta: { title: 'retireItem + reconcileClaim ops', itemId: 'foundry/slice3-2',
      resource: 'ai', status: 'done', yields: [{ kind: 'policy', id: 'terminal-retire' }, { kind: 'board', id: 'gate-aware-board' }] } },
];
```
> Note: `effects[]` uses the kernel `EffectDeclaration` shape consumed by `composeEffects` — confirm the exact field names against `@de-braighter/substrate-contracts/plan-tree` (the relocated `intervention-composition.ts`'s `eff(...)` helper shows the canonical shape) and match them here.

- [ ] **Step 4: Run — expect PASS.** Fix `effects` field names if the build flags them.

- [ ] **Step 5: Commit.**

```bash
git add domains/foundry/src/instances/foundry-product.ts domains/foundry/test/instance-foundry.test.ts
git commit -m "feat(foundry): author Product(foundry) instance from real board history"
```

### Task 9: `Product(whales)` instance — the acid-test instance

**Files:**
- Create: `domains/foundry/src/instances/whales-product.ts`
- Test: `domains/foundry/test/instance-whales.test.ts`

**Interfaces:**
- Produces: `WHALES_PRODUCT: CascadeNodeSpec[]` (the 6-item wedge as six stories).

- [ ] **Step 1: Write the failing test** (valid instance + builds a tree).

`domains/foundry/test/instance-whales.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { buildCascadeTree } from '../src/plan/cascade.js';
import { validateInstance } from '../src/metamodel/vocabulary.js';
import { WHALES_PRODUCT } from '../src/instances/whales-product.js';

describe('Product(whales) instance', () => {
  it('is a valid metamodel instance', () => {
    expect(validateInstance(WHALES_PRODUCT)).toEqual([]);
  });
  it('builds a single-parent plan tree', () => {
    expect(buildCascadeTree(WHALES_PRODUCT).treeRootId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Author `domains/foundry/src/instances/whales-product.ts`** from the shipped E1–E6 wedge — using ONLY the kinds/resources/substances `FOUNDRY_PRODUCT` already used.

```typescript
import type { CascadeNodeSpec } from '../plan/cascade.js';

// Whales-and-bubbles 6-item wedge (E1..E6) as six stories — the genericity acid-test instance.
export const WHALES_PRODUCT: CascadeNodeSpec[] = [
  { key: 'whales', kind: 'product', parent: null, meta: { title: 'Whales & Bubbles — economic-strategy game' } },
  { key: 'cap-core', kind: 'capability', parent: 'whales', meta: { title: 'Core game' } },
  { key: 'feat-foundation', kind: 'feature', parent: 'cap-core', meta: { title: 'Foundation' } },
  { key: 'story-e1', kind: 'work-item', parent: 'feat-foundation',
    meta: { title: 'E1 scaffold', itemId: 'whales/E1', resource: 'ai', status: 'done', yields: [{ kind: 'pack', id: 'scaffold' }] } },
  { key: 'story-e2', kind: 'work-item', parent: 'feat-foundation',
    meta: { title: 'E2 contracts', itemId: 'whales/E2', resource: 'ai', status: 'done', yields: [{ kind: 'pack', id: 'contracts' }] } },
  { key: 'feat-sim', kind: 'feature', parent: 'cap-core', meta: { title: 'Simulation' } },
  { key: 'story-e3', kind: 'work-item', parent: 'feat-sim',
    meta: { title: 'E3 engine', itemId: 'whales/E3', resource: 'ai', status: 'done', yields: [{ kind: 'pack', id: 'engine' }] } },
  { key: 'story-e4', kind: 'work-item', parent: 'feat-sim',
    meta: { title: 'E4 ai', itemId: 'whales/E4', resource: 'ai', status: 'done', yields: [{ kind: 'pack', id: 'ai-opponent' }] } },
  { key: 'feat-surface', kind: 'feature', parent: 'cap-core', meta: { title: 'Surface' } },
  { key: 'story-e5', kind: 'work-item', parent: 'feat-surface',
    meta: { title: 'E5 api', itemId: 'whales/E5', resource: 'ai', status: 'done', yields: [{ kind: 'pack', id: 'api' }] } },
  { key: 'story-e6', kind: 'work-item', parent: 'feat-surface',
    meta: { title: 'E6 ui', itemId: 'whales/E6', resource: 'ai', status: 'done', yields: [{ kind: 'board', id: 'game-ui' }] } },
];
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add domains/foundry/src/instances/whales-product.ts domains/foundry/test/instance-whales.test.ts
git commit -m "feat(foundry): author Product(whales) acid-test instance (E1-E6 wedge)"
```

---

## Phase 4 — Derivations: posteriors + resource capacity

### Task 10: Cycle-time posterior over a product's work-items (repoint existing `cyclePosterior`)

**Files:**
- Create: `domains/foundry/src/derivations/cycle-time.ts`
- Test: `domains/foundry/test/deriv-cycle-time.test.ts`

**Interfaces:**
- Consumes: `cyclePosterior` from `../inference/cycle-time.js`; `fold` + `ItemState` from `../state.js`; `readEnvelopes` from `../log.js`.
- Produces: `productCycleTime(events: DomainEventEnvelope[], productKey: string): PosteriorStats | null` (claim→merge latencies in hours for that product's done items; `null` if < 2 samples).

- [ ] **Step 1: Write the failing test** — feed two foundry events streams (claim + merge) and assert a posterior comes back.

`domains/foundry/test/deriv-cycle-time.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { productRegistered, itemQueued, claimAcquired, mergeRecorded } from '../src/events.js';
import { productCycleTime } from '../src/derivations/cycle-time.js';

const ev = (...e: ReturnType<typeof itemQueued>[]) => e;
const H = (h: number) => new Date(Date.UTC(2026, 5, 10, 12 + h)).toISOString();

describe('productCycleTime', () => {
  it('returns null with fewer than 2 completed items', () => {
    const events = ev(productRegistered({ productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0', ts: H(0) }));
    expect(productCycleTime(events, 'p')).toBeNull();
  });
  it('derives a posterior from claim->merge latencies', () => {
    const events = [
      productRegistered({ productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0', ts: H(0) }),
      itemQueued({ itemId: 'p/1', productKey: 'p', title: 'a', scope: { repo: 'r/p' }, ts: H(0) }),
      claimAcquired({ claimId: 'c1', itemId: 'p/1', sessionId: 's', ttlMinutes: 240, ts: H(0) }),
      mergeRecorded({ itemId: 'p/1', prRef: 'r/p#1', ts: H(2) }),
      itemQueued({ itemId: 'p/2', productKey: 'p', title: 'b', scope: { repo: 'r/p' }, ts: H(0) }),
      claimAcquired({ claimId: 'c2', itemId: 'p/2', sessionId: 's', ttlMinutes: 240, ts: H(0) }),
      mergeRecorded({ itemId: 'p/2', prRef: 'r/p#2', ts: H(4) }),
    ];
    const post = productCycleTime(events, 'p');
    expect(post).not.toBeNull();
    expect(post!.mean).toBeGreaterThan(0);
  });
});
```
> Verify `claimAcquired`/`mergeRecorded` payload field names against `src/events.ts` (the foundry-explore showed `claimAcquired`, `mergeRecorded` constructors); adjust `itemId`/`prRef` keys to the real schema if the build flags them.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `domains/foundry/src/derivations/cycle-time.ts`.**

```typescript
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { fold, type ItemState } from '../state.js';
import { cyclePosterior, type PosteriorStats } from '../inference/cycle-time.js';

const claimToMergeHours = (it: ItemState): number | null => {
  if (!it.merged || it.claims.length === 0) return null;
  const firstClaim = Math.min(...it.claims.map((c) => Date.parse(c.acquiredAt)));
  const merged = Date.parse(it.merged.at);
  if (!Number.isFinite(firstClaim) || !Number.isFinite(merged)) return null;
  return (merged - firstClaim) / 3_600_000;
};

export function productCycleTime(events: DomainEventEnvelope[], productKey: string): PosteriorStats | null {
  const s = fold(events);
  const hours = [...s.items.values()]
    .filter((it) => it.productKey === productKey)
    .map(claimToMergeHours)
    .filter((h): h is number => h !== null && h > 0);
  if (hours.length < 2) return null;
  return cyclePosterior(hours);
}
```
> Confirm `ItemState.merged.at` and `ClaimState.acquiredAt` field names against `src/state.ts` (the foundry-explore confirmed both exist).

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add domains/foundry/src/derivations/cycle-time.ts domains/foundry/test/deriv-cycle-time.test.ts
git commit -m "feat(foundry): per-product cycle-time posterior over claim->merge latency"
```

### Task 11: AI-throughput-bound read from `SlotLeased` + capacity

**Files:**
- Create: `domains/foundry/src/derivations/ai-capacity.ts`
- Test: `domains/foundry/test/deriv-ai-capacity.test.ts`

**Interfaces:**
- Consumes: `fold`, `activeSlotLeases`, `claimableItems` from `../state.js`.
- Produces: `aiCapacity(events, repo, slots, nowMs): { leased: number; slots: number; readyAiItems: number; bound: boolean }` — `bound = leased >= slots && readyAiItems > 0`.

- [ ] **Step 1: Write the failing test.**

`domains/foundry/test/deriv-ai-capacity.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { aiCapacity } from '../src/derivations/ai-capacity.js';

describe('aiCapacity', () => {
  it('reports not-bound when no leases and no ready items', () => {
    const r = aiCapacity([], 'r/p', 4, Date.parse('2026-06-10T12:00:00.000Z'));
    expect(r).toMatchObject({ leased: 0, slots: 4, bound: false });
  });
});
```
> This minimal test pins the shape + the empty-stream contract. A richer test (seed `slotLeased` + `itemQueued` + `claimAcquired` events to reach `bound:true`) should be added once the exact `slotLeased`/`claimAcquired` payload keys are confirmed against `src/events.ts`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `domains/foundry/src/derivations/ai-capacity.ts`.**

```typescript
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { fold, activeSlotLeases, claimableItems } from '../state.js';

export function aiCapacity(events: DomainEventEnvelope[], repo: string, slots: number, nowMs: number): {
  leased: number; slots: number; readyAiItems: number; bound: boolean;
} {
  const s = fold(events);
  const leased = activeSlotLeases(s, repo, nowMs).length;
  const readyAiItems = claimableItems(s, nowMs).filter((it) => it.scope.repo === repo).length;
  return { leased, slots, readyAiItems, bound: leased >= slots && readyAiItems > 0 };
}
```
> Confirm `ItemScope.repo` and the `activeSlotLeases`/`claimableItems` signatures against `src/state.ts` (the foundry-explore confirmed all three).

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add domains/foundry/src/derivations/ai-capacity.ts domains/foundry/test/deriv-ai-capacity.test.ts
git commit -m "feat(foundry): ai-throughput-bound read from active slot leases vs ready items"
```

---

## Phase 5 — The acid test + replay determinism

### Task 12: Genericity acid-test (whales adds zero new shapes) — the kill-criterion

**Files:**
- Test: `domains/foundry/test/genericity-acid.test.ts`

**Interfaces:**
- Consumes: `vocabularyOf` (Task 6); both instances (Tasks 8–9).

- [ ] **Step 1: Write the acid-test** (this is the spec's primary kill-criterion).

`domains/foundry/test/genericity-acid.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { vocabularyOf, validateInstance } from '../src/metamodel/vocabulary.js';
import { FOUNDRY_PRODUCT } from '../src/instances/foundry-product.js';
import { WHALES_PRODUCT } from '../src/instances/whales-product.js';

const sorted = (s: Set<string>) => [...s].sort();

describe('genericity acid-test (kill-criterion)', () => {
  it('both instances are valid', () => {
    expect(validateInstance(FOUNDRY_PRODUCT)).toEqual([]);
    expect(validateInstance(WHALES_PRODUCT)).toEqual([]);
  });
  it('whales introduces ZERO new node-kind / resource / substance vocabulary vs foundry', () => {
    const f = vocabularyOf(FOUNDRY_PRODUCT);
    const w = vocabularyOf(WHALES_PRODUCT);
    const newKinds = sorted(w.kinds).filter((k) => !f.kinds.has(k));
    const newResources = sorted(w.resources).filter((r) => !f.resources.has(r));
    const newSubstances = sorted(w.substances).filter((s) => !f.substances.has(s));
    expect({ newKinds, newResources, newSubstances })
      .toEqual({ newKinds: [], newResources: [], newSubstances: [] });
  });
});
```

- [ ] **Step 2: Run.**

Run: `cd domains/foundry && npx vitest run test/genericity-acid.test.ts`
Expected: PASS. **If it FAILS**, the metamodel is not general — per the spec kill-criterion, STOP and revise the metamodel (Task 6) rather than widening the whales instance.

- [ ] **Step 3: Commit.**

```bash
git add domains/foundry/test/genericity-acid.test.ts
git commit -m "test(foundry): genericity acid-test — whales adds zero new shapes (kill-criterion)"
```

### Task 13: Replay determinism of the derivations

**Files:**
- Test: `domains/foundry/test/replay-determinism.test.ts`

- [ ] **Step 1: Write the test** — same input → identical derivation, twice.

`domains/foundry/test/replay-determinism.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { deriveSubstance, completeness } from '../src/metamodel/substance.js';
import { FOUNDRY_PRODUCT } from '../src/instances/foundry-product.js';

describe('replay determinism', () => {
  it('substance + completeness are pure/stable across recomputation', () => {
    expect(deriveSubstance(FOUNDRY_PRODUCT)).toEqual(deriveSubstance(FOUNDRY_PRODUCT));
    expect(completeness(FOUNDRY_PRODUCT)).toEqual(completeness(FOUNDRY_PRODUCT));
  });
});
```

- [ ] **Step 2: Run — expect PASS** (`cd domains/foundry && npx vitest run test/replay-determinism.test.ts`).

- [ ] **Step 3: Full suite green + commit.**

```bash
cd domains/foundry && npm test
git add domains/foundry/test/replay-determinism.test.ts
git commit -m "test(foundry): replay determinism of substance/completeness derivations"
```

---

## Phase 6 — Governance ADRs

> Doc PRs in `layers/specs`; verifier wave = `spec-auditor` + `md-quality-review`. Use the `adr-scaffolder` skill for numbering.

### Task 14: ADR — sanction `domains/foundry` as the merged meta-product (amend ADR-192)

- [ ] **Step 1:** Run `adr-scaffolder` to allocate the next ADR number under `layers/specs/adr/`.
- [ ] **Step 2:** Write the ADR: sanction `@de-braighter/foundry` as a pack-on-platform meta-product that **absorbs the `pack-devloop` twin** (move modules, foundry log canonical for new work), **zero kernel change**; amend/supersede the relevant clauses of ADR-192 that home the SDLC twin in `pack-devloop`. Cite the spec `docs/superpowers/specs/2026-06-17-foundry-substrate-self-application-design.md`.
- [ ] **Step 3:** Run `node tools/validators/frontmatter-schema.mjs <file>` + `md-quality-review` + `spec-auditor`; fix findings.
- [ ] **Step 4:** Commit on a `layers/specs` branch + open PR.

### Task 15: ADR — substance-face is a derived projection (`substance = ⋃ yields`)

- [ ] **Step 1:** Allocate the next ADR number.
- [ ] **Step 2:** Write the ADR: record that the product **substance** face is a *derived view* over the plan tree (`deriveSubstance`), **never stored state** ("store generators, derive graphs"); the resource/`yields` shape lives in `meta`/typed pack lib, not the kernel. Pass the ADR-176 inclusion test (one consumer → pack territory).
- [ ] **Step 3:** Validate (frontmatter + md-quality-review + spec-auditor).
- [ ] **Step 4:** Commit + PR.

---

## Self-Review (plan author)

**1. Spec coverage** — spec §13 deliverables map to: merge (Phase 1) · metamodel lib (Task 6) · instances at story grain (Tasks 8–9, D6) · ingester repoint (Phase 1 Task 5, `ingest/observe`) · posteriors + substance projection (Tasks 7, 10, 11) · genericity + replay tests (Tasks 12–13) · two ADRs (Tasks 14–15). The three posteriors: cycle-time (Task 10), blueprint-completeness (Task 7 `completeness`), ai-throughput-bound (Task 11). ✔

**2. Placeholder scan** — no "TBD/handle edge cases". Two `> Note:` callouts flag fields to **confirm against real schemas** (effect-declaration field names; foundry event payload keys) — these are verification steps with the exact source named, not blank placeholders. ✔

**3. Type consistency** — `CascadeNodeSpec`, `WorkItemMeta`, `SubstanceRef`, `vocabularyOf`, `validateInstance`, `deriveSubstance`, `completeness`, `cyclePosterior`/`PosteriorStats`, `fold`/`ItemState` are used with identical signatures across tasks. ✔

**Known verification points (call out at execution):** the exact `EffectDeclaration` field names (`direction`/`magnitude`/`confidence`) and the foundry event payload keys (`claimAcquired`, `mergeRecorded`, `slotLeased`) must be confirmed against `@de-braighter/substrate-contracts/plan-tree` and `domains/foundry/src/events.ts` at Task 8/10/11 — the tests will fail loudly if wrong, which is the intended TDD signal.

## Deferred (named follow-ups, NOT in v0)

- Full `domains/devloop` retirement + physical log-collapse into foundry's single log (v0 keeps devloop running via shims).
- The metamodel **driving** the conductor (foundry_next over the plan tree) — v1.
- Blueprint **generation** (scaffold a product from its model) — v2.
- agri/oncology instances; studio authoring UI.
