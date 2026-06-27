# Foundry Generation SDK — Slice 1 (Angular-feature generator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the metamodel-first Generation SDK + `gen_*` MCP surface for the `angular-feature` kind, proving the loop closes end-to-end (schema-validate → policy → deterministic render → fenced logic slot → event-coupled run → replay), per ADR-274 D7 and the companion concept §8.

**Architecture:** A foundry-internal SDK module at `domains/foundry/src/generation/` (OQ-4 defers `@de-braighter/*` publication). The SDK is the stable engine (schemas/policies/templates/renderers/context-packs/failure/verify/generate); a thin `gen_*` MCP layer delegates to it (mirrors the existing `tools.ts`→`ops.ts` split). The render is a **pure function** of `(model, templateSetVersion, contextPackHash)` — there is no executable Nx generator in the cluster to shell out to (verified: `angular-feature-generator-decomposition-aware` is a *prose advisory skill*, and a stateful `nx g` schematic could never be byte-identical/golden-tested), so `templateSet@v1` **encodes the skill's decomposition contract** as pure string templates. Generation runs emit two **additive Foundry** event types into the existing `events.jsonl`, coupled to a Foundry `claimRef`.

**Tech Stack:** TypeScript (ESM, `moduleResolution: bundler`, `.js` import specifiers, `strict` + `noUncheckedIndexedAccess`), Zod 3, vitest 2, `@de-braighter/substrate-contracts` (published — for `DomainEventEnvelopeSchema` only). **No new runtime dependencies.**

## Global Constraints

- **ADR-176 — kernel grows by ZERO.** Nothing lands in `layers/substrate`; nothing is added to `@de-braighter/substrate-contracts`. All schemas/catalogs/policies/templates/renderers/events are foundry pack/tooling territory. Charter-checker enforces this — it is the highest-stakes gate.
- **D2 — closed modelable surface.** Every model node is a typed field or the ONE escape hatch (a fenced, typed, unit-tested logic slot). No free-form code-as-JSON. Slice 1 has exactly one logic-slot kind (the component computed-signal); the op-catalog crux is **slice 2** — `describeOpCatalog` returns a minimal illustrative set with a `// TODO(slice-2): curate opCatalog@v1` note.
- **D3 — determinism is a contract.** `render(model, templateSetVersion, contextPackHash)` has no wall-clock, no network, no `Math.random()`. Same triple → byte-identical files, asserted by golden + replay tests. A template change that alters output without a `templateSetVersion` bump must turn the golden RED (`golden-drift`).
- **D5 — MCP↔SDK boundary.** `gen_*` MCP tools are pure inbound adapters (Zod parse, `isError` shaping, single SDK call). No engine logic in the MCP.
- **D6 — event-sourced runs.** `generate` takes a `claimRef` and appends `foundry:GenerationRun.v1` + `foundry:ArtifactGenerated.v1` as `DomainEventEnvelope`s into the existing log via the existing `append(env, logPath)` (which already holds `withLogLock` for cross-process safety — the board-editor-studio session writes the same log). No parallel log.
- **Injected effects for determinism.** Any `now`/id the SDK needs is injected via a deps object (`now?: () => string`, `newId?: () => string`) exactly like `ops.ts`/`tools.ts` do — tests pin them; production defaults to `() => new Date().toISOString()` / `randomUUID`.
- **House idioms.** Zod object schemas exported as `*Schema` with inferred types; ESM imports end in `.js`; event constructors follow the `events.ts` pattern (string const in `EVENT` → pack-local payload schema → typed constructor → `envelope()` wrapper); tests are vitest `describe/it` with `expect`.
- **Scope guard.** Touch ONLY `domains/foundry`. Do NOT touch `domains/studio/libs/board-editor` (a live autonomous chain).

## File Structure

Created under `domains/foundry/`:

```
src/generation/
├── hash.ts                       — canonicalJson(value) + sha256Hex(str) + hashModel/hashContextPack
├── modes.ts                      — GENERATION_MODES tuple + GenerationMode type
├── kinds.ts                      — GENERATION_KINDS ReadonlyMap + listKinds()
├── slots.ts                      — emitSlot(), isSlotFilled(), extractSlots(), SLOT regex
├── op-catalog/index.ts           — describeOpCatalog(kind) (slice-1 minimal; TODO slice-2)
├── failure.ts                    — FAILURE_CLASSES taxonomy + explainFailure()/classifyFailure()
├── context-packs/index.ts        — ContextPackSchema + buildContextPack()
├── schemas/angular-feature.ts    — AngularFeatureModelSchema (Zod) + ANGULAR_FEATURE_JSON_SCHEMA + describeSchema()
├── policies/angular-feature.ts   — evaluateAngularFeaturePolicy(model) → PolicyFinding[]
├── validate.ts                   — validateModel(kind, model) → { ok, schemaErrors, policyFindings }
├── templates/angular-feature/v1.ts — renderAngularFeatureV1(model, contextPackHash) → RenderedFile[]
├── renderers/angular-feature.ts  — render dispatch by (kind, templateSetVersion)
├── preview.ts                    — preview(kind, model) → { files, slots, mode }
├── generate.ts                   — generate(deps, { kind, model, claimRef }) → GeneratedArtifactReport (+ writes + events)
├── verify.ts                     — verifyArtifact(deps, report) → { ok, findings }
├── propose.ts                    — proposeOp(...) → { proposalId } (thin; slice-1 stub w/ TODO)
└── index.ts                      — the SDK public API barrel
src/mcp/gen-tools.ts              — makeGenTools(deps): gen_* handlers (guard-wrapped delegations)
```

Modified:

```
src/events.ts   — add EVENT.GENERATION_RUN/ARTIFACT_GENERATED + payload schemas + constructors
src/scope.ts    — add genRunAggregateId(runId)
src/mcp/server.ts — register the gen_* tools
```

Tests under `domains/foundry/test/`:

```
test/gen-hash.test.ts
test/gen-kinds.test.ts
test/gen-slots.test.ts
test/gen-schema-angular-feature.test.ts
test/gen-policy-angular-feature.test.ts
test/gen-validate.test.ts
test/gen-failure.test.ts
test/gen-context-pack.test.ts
test/gen-render-angular-feature.test.ts   — golden + replay + drift
test/gen-events.test.ts                    — the two new event constructors
test/gen-generate.acid.test.ts             — write + event coupling + preview
test/gen-verify.test.ts
test/gen-mcp.test.ts
test/gen-e2e.acid.test.ts                  — the 8 slice-1 acceptance criteria
test/golden/angular-feature/v1/player-roster/  — checked-in expected file tree
```

---

### Task 1: Hashing + canonical JSON

**Files:**
- Create: `src/generation/hash.ts`
- Test: `test/gen-hash.test.ts`

**Interfaces:**
- Produces: `canonicalJson(value: unknown): string`, `sha256Hex(input: string): string`, `hashModel(model: unknown): string`, `hashContextPack(pack: unknown): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex, hashModel } from '../src/generation/hash.js';

describe('canonicalJson', () => {
  it('is stable regardless of key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });
  it('sorts nested object keys too', () => {
    expect(canonicalJson({ x: { d: 1, c: 2 } })).toBe('{"x":{"c":2,"d":1}}');
  });
  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('sha256Hex', () => {
  it('matches a known vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('hashModel', () => {
  it('is order-independent on keys', () => {
    expect(hashModel({ b: 1, a: 2 })).toBe(hashModel({ a: 2, b: 1 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/gen-hash.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// Deterministic, dependency-free canonical JSON + sha256 — the spine of the
// replay key (modelHash, contextPackHash). Pure: no wall-clock, no randomness.
import { createHash } from 'node:crypto';

/** Stable JSON: object keys sorted recursively, arrays preserved, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export const hashModel = (model: unknown): string => sha256Hex(canonicalJson(model));
export const hashContextPack = (pack: unknown): string => sha256Hex(canonicalJson(pack));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/gen-hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generation/hash.ts test/gen-hash.test.ts
git commit -m "feat(gen): canonical-json + sha256 replay-key hashing"
```

---

### Task 2: Generation modes + kinds registry

**Files:**
- Create: `src/generation/modes.ts`, `src/generation/kinds.ts`
- Test: `test/gen-kinds.test.ts`

**Interfaces:**
- Produces: `GENERATION_MODES` (tuple), `type GenerationMode`; `type GenerationKind = 'angular-feature' | 'service-method' | 'pack-scaffold'`; `interface GenerationKindInfo { kind, mode, schemaRef, neverAiFree }`; `GENERATION_KINDS: ReadonlyMap<GenerationKind, GenerationKindInfo>`; `listKinds(): GenerationKindInfo[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { listKinds } from '../src/generation/kinds.js';
import { GENERATION_MODES } from '../src/generation/modes.js';

describe('generation modes', () => {
  it('is the closed four-mode set', () => {
    expect([...GENERATION_MODES]).toEqual(['deterministic', 'bounded', 'agentic', 'exploratory']);
  });
});

describe('listKinds', () => {
  it('returns angular-feature with mode bounded, not never-ai-free', () => {
    const af = listKinds().find((k) => k.kind === 'angular-feature');
    expect(af).toEqual({
      kind: 'angular-feature',
      mode: 'bounded',
      schemaRef: 'angular-feature@v1',
      neverAiFree: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run test/gen-kinds.test.ts` → FAIL.

- [ ] **Step 3: Write implementation**

```ts
// modes.ts — the closed Generation Mode set (concept §4.3). The mode is a
// property of the artifact kind + policy, not a free per-run choice.
export const GENERATION_MODES = ['deterministic', 'bounded', 'agentic', 'exploratory'] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];
```

```ts
// kinds.ts — the generation-kind registry: a static ReadonlyMap derived at
// module load ("store generators, derive graphs", ADR-252/ADR-176). Slice 1
// ships angular-feature; service-method (slice 2) + pack-scaffold are declared
// so list_kinds advertises the roadmap, but only angular-feature renders.
import type { GenerationMode } from './modes.js';

export type GenerationKind = 'angular-feature' | 'service-method' | 'pack-scaffold';

export interface GenerationKindInfo {
  kind: GenerationKind;
  mode: GenerationMode;
  schemaRef: string;
  neverAiFree: boolean;
}

export const GENERATION_KINDS: ReadonlyMap<GenerationKind, GenerationKindInfo> = new Map([
  ['angular-feature', { kind: 'angular-feature', mode: 'bounded', schemaRef: 'angular-feature@v1', neverAiFree: false }],
] as const);

export const listKinds = (): GenerationKindInfo[] => [...GENERATION_KINDS.values()];
```

> Note: only `angular-feature` is registered in slice 1 (it is the only kind that renders). The `GenerationKind` *type* names the slice-2/deferred kinds so signatures are forward-compatible, but unregistered kinds are absent from `listKinds()`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run test/gen-kinds.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): generation modes + kinds registry"`

---

### Task 3: Logic-slot fence helpers

**Files:**
- Create: `src/generation/slots.ts`
- Test: `test/gen-slots.test.ts`

**Interfaces:**
- Produces: `interface SlotSpec { id: string; inputs: string; output: string; purpose: string }`; `interface SlotRef { id: string; inputs: string; output: string }`; `emitSlot(spec: SlotSpec): string`; `isSlotFilled(source: string, id: string): boolean`; `extractSlots(source: string): SlotRef[]`.

The fence is machine-detectable and survives regeneration. The throwing stub is the unfilled marker.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { emitSlot, isSlotFilled, extractSlots } from '../src/generation/slots.js';

const spec = { id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string', purpose: 'one-line roster summary' };

describe('emitSlot', () => {
  it('emits a fenced, typed throwing stub', () => {
    const s = emitSlot(spec);
    expect(s).toContain('// <generation:logic-slot id="rosterSummary" inputs="players: PlayerVm[]" output="string">');
    expect(s).toContain('// PURPOSE: one-line roster summary');
    expect(s).toContain('export function rosterSummary(players: PlayerVm[]): string {');
    expect(s).toContain(`throw new Error('logic-slot not implemented: rosterSummary');`);
    expect(s).toContain('// </generation:logic-slot>');
  });
});

describe('isSlotFilled', () => {
  it('is false while the throwing stub remains', () => {
    expect(isSlotFilled(emitSlot(spec), 'rosterSummary')).toBe(false);
  });
  it('is true once the stub body is replaced', () => {
    const filled = emitSlot(spec).replace(
      `throw new Error('logic-slot not implemented: rosterSummary');`,
      'return players.length + " players";',
    );
    expect(isSlotFilled(filled, 'rosterSummary')).toBe(true);
  });
});

describe('extractSlots', () => {
  it('finds the slot id + signature in the source', () => {
    expect(extractSlots(emitSlot(spec))).toEqual([{ id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Write implementation**

```ts
// Logic-slot fences (concept §4.2): the ONE escape hatch from the closed
// modelable surface. A slot is bounded (single function scope), marked (the
// machine-detectable fence survives regeneration), and verified (the throwing
// stub is the unfilled marker; the policy requires a named unit test).
export interface SlotSpec { id: string; inputs: string; output: string; purpose: string }
export interface SlotRef { id: string; inputs: string; output: string }

export const slotStub = (id: string): string => `logic-slot not implemented: ${id}`;

export function emitSlot(spec: SlotSpec): string {
  const { id, inputs, output, purpose } = spec;
  return [
    `// <generation:logic-slot id="${id}" inputs="${inputs}" output="${output}">`,
    `// PURPOSE: ${purpose}`,
    `export function ${id}(${inputs}): ${output} {`,
    `  throw new Error('${slotStub(id)}');`,
    `}`,
    `// </generation:logic-slot>`,
  ].join('\n');
}

export function isSlotFilled(source: string, id: string): boolean {
  // Unfilled ⇔ the exact throwing stub for this id is still present.
  return !source.includes(`throw new Error('${slotStub(id)}');`);
}

const SLOT_OPEN = /\/\/ <generation:logic-slot id="([^"]+)" inputs="([^"]*)" output="([^"]*)">/g;

export function extractSlots(source: string): SlotRef[] {
  const out: SlotRef[] = [];
  for (const m of source.matchAll(SLOT_OPEN)) out.push({ id: m[1]!, inputs: m[2]!, output: m[3]! });
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): logic-slot fence helpers (emit/detect/extract)"`

---

### Task 4: angular-feature metamodel schema

**Files:**
- Create: `src/generation/schemas/angular-feature.ts`
- Test: `test/gen-schema-angular-feature.test.ts`

**Interfaces:**
- Produces: `AngularFeatureModelSchema` (Zod), `type AngularFeatureModel`, `ANGULAR_FEATURE_JSON_SCHEMA` (a hand-authored JSON Schema constant mirroring the Zod shape), `describeSchema(kind: string): object`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { AngularFeatureModelSchema, describeSchema } from '../src/generation/schemas/angular-feature.js';

const valid = {
  kind: 'angular-feature',
  templateSetVersion: 'angular-feature@v1',
  featureName: 'player-roster',
  selectorPrefix: 'app',
  route: 'players',
  viewModel: { name: 'PlayerVm', fields: [{ name: 'name', type: 'string' }] },
  i18nKeys: { de: { 'players.title': 'Aufstellung' }, en: { 'players.title': 'Roster' } },
  a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: ['axe-core', 'keyboard-nav'] },
  computedSignal: { id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string', purpose: 'one-line roster summary' },
};

describe('AngularFeatureModelSchema', () => {
  it('accepts a complete model', () => {
    expect(AngularFeatureModelSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects a non-kebab featureName', () => {
    expect(AngularFeatureModelSchema.safeParse({ ...valid, featureName: 'PlayerRoster' }).success).toBe(false);
  });
  it('rejects a missing computedSignal (the logic slot is mandatory)', () => {
    const { computedSignal, ...rest } = valid;
    expect(AngularFeatureModelSchema.safeParse(rest).success).toBe(false);
  });
});

describe('describeSchema', () => {
  it('returns the JSON Schema for angular-feature', () => {
    const js = describeSchema('angular-feature') as { $id?: string; properties?: Record<string, unknown> };
    expect(js.$id).toBe('angular-feature@v1');
    expect(js.properties).toHaveProperty('a11yBattery');
  });
  it('throws on an unknown kind', () => {
    expect(() => describeSchema('nope')).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Write implementation**

```ts
// The angular-feature artifact metamodel (concept §4.4). Closed + typed: the
// AI authors THIS, never a file. The only logic-bearing field is computedSignal
// (the one logic slot). i18nKeys + a11yBattery presence are policy-checked (D4).
import { z } from 'zod';

const kebab = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'must be kebab-case');

export const AngularFeatureModelSchema = z.object({
  kind: z.literal('angular-feature'),
  templateSetVersion: z.literal('angular-feature@v1'),
  featureName: kebab,
  selectorPrefix: kebab,
  route: z.string().min(1),
  viewModel: z.object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'PascalCase'),
    fields: z.array(z.object({ name: z.string().min(1), type: z.string().min(1) })).min(1),
  }),
  i18nKeys: z.object({ de: z.record(z.string()), en: z.record(z.string()) }),
  a11yBattery: z.object({
    landmarkRole: z.string().min(1),
    headingLevel: z.number().int().min(1).max(6),
    checks: z.array(z.string().min(1)),
  }),
  computedSignal: z.object({
    id: z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'camelCase'),
    inputs: z.string().min(1),
    output: z.string().min(1),
    purpose: z.string().min(1),
  }),
}).strict();

export type AngularFeatureModel = z.infer<typeof AngularFeatureModelSchema>;

// Hand-authored JSON Schema mirroring the Zod shape (no zod-to-json-schema dep).
// A parity test (this file's spec) keeps it honest against the Zod schema.
export const ANGULAR_FEATURE_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'angular-feature@v1',
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'templateSetVersion', 'featureName', 'selectorPrefix', 'route', 'viewModel', 'i18nKeys', 'a11yBattery', 'computedSignal'],
  properties: {
    kind: { const: 'angular-feature' },
    templateSetVersion: { const: 'angular-feature@v1' },
    featureName: { type: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' },
    selectorPrefix: { type: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' },
    route: { type: 'string', minLength: 1 },
    viewModel: {
      type: 'object', additionalProperties: false, required: ['name', 'fields'],
      properties: {
        name: { type: 'string', pattern: '^[A-Z][A-Za-z0-9]*$' },
        fields: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['name', 'type'], properties: { name: { type: 'string' }, type: { type: 'string' } } } },
      },
    },
    i18nKeys: { type: 'object', additionalProperties: false, required: ['de', 'en'], properties: { de: { type: 'object', additionalProperties: { type: 'string' } }, en: { type: 'object', additionalProperties: { type: 'string' } } } },
    a11yBattery: { type: 'object', additionalProperties: false, required: ['landmarkRole', 'headingLevel', 'checks'], properties: { landmarkRole: { type: 'string' }, headingLevel: { type: 'integer', minimum: 1, maximum: 6 }, checks: { type: 'array', items: { type: 'string' } } } },
    computedSignal: { type: 'object', additionalProperties: false, required: ['id', 'inputs', 'output', 'purpose'], properties: { id: { type: 'string', pattern: '^[a-z][A-Za-z0-9]*$' }, inputs: { type: 'string' }, output: { type: 'string' }, purpose: { type: 'string' } } },
  },
} as const;

export function describeSchema(kind: string): object {
  if (kind === 'angular-feature') return ANGULAR_FEATURE_JSON_SCHEMA;
  throw new Error(`no schema for kind: ${kind}`);
}
```

- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): angular-feature metamodel schema + json-schema"`

---

### Task 5: angular-feature policy

**Files:**
- Create: `src/generation/policies/angular-feature.ts`
- Test: `test/gen-policy-angular-feature.test.ts`

**Interfaces:**
- Produces: `interface PolicyFinding { policy: string; severity: 'error' | 'warn'; message: string }`; `evaluateAngularFeaturePolicy(model: AngularFeatureModel): PolicyFinding[]`. Empty array ⇒ pass.

Policies (D4): a11y battery non-empty (≥1 check); i18n keys present for both de + en AND the route title key present in each; the computedSignal id is non-empty (its mandatory unit test is enforced at verify time).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateAngularFeaturePolicy } from '../src/generation/policies/angular-feature.js';
import type { AngularFeatureModel } from '../src/generation/schemas/angular-feature.js';

const base: AngularFeatureModel = {
  kind: 'angular-feature', templateSetVersion: 'angular-feature@v1',
  featureName: 'player-roster', selectorPrefix: 'app', route: 'players',
  viewModel: { name: 'PlayerVm', fields: [{ name: 'name', type: 'string' }] },
  i18nKeys: { de: { 'players.title': 'Aufstellung' }, en: { 'players.title': 'Roster' } },
  a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: ['axe-core'] },
  computedSignal: { id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string', purpose: 'p' },
};

describe('angular-feature policy', () => {
  it('passes a complete model', () => {
    expect(evaluateAngularFeaturePolicy(base)).toEqual([]);
  });
  it('flags an empty a11y battery', () => {
    const f = evaluateAngularFeaturePolicy({ ...base, a11yBattery: { ...base.a11yBattery, checks: [] } });
    expect(f).toContainEqual(expect.objectContaining({ policy: 'a11y-battery-present', severity: 'error' }));
  });
  it('flags missing en i18n keys', () => {
    const f = evaluateAngularFeaturePolicy({ ...base, i18nKeys: { de: base.i18nKeys.de, en: {} } });
    expect(f).toContainEqual(expect.objectContaining({ policy: 'i18n-keys-present', severity: 'error' }));
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation**

```ts
// Policy-as-code (concept §4.4 R5): deterministic rules a schema-valid model
// must pass BEFORE render. Versioned data, evaluated purely.
import type { AngularFeatureModel } from '../schemas/angular-feature.js';

export interface PolicyFinding { policy: string; severity: 'error' | 'warn'; message: string }

export function evaluateAngularFeaturePolicy(model: AngularFeatureModel): PolicyFinding[] {
  const out: PolicyFinding[] = [];
  if (model.a11yBattery.checks.length === 0) {
    out.push({ policy: 'a11y-battery-present', severity: 'error', message: 'a11yBattery.checks must list ≥1 accessibility check' });
  }
  const titleKey = `${model.route}.title`;
  for (const locale of ['de', 'en'] as const) {
    const bundle = model.i18nKeys[locale];
    if (Object.keys(bundle).length === 0 || !(titleKey in bundle)) {
      out.push({ policy: 'i18n-keys-present', severity: 'error', message: `i18nKeys.${locale} must include the route title key "${titleKey}"` });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): angular-feature policy (a11y battery + i18n keys)"`

---

### Task 6: validateModel (schema + policy)

**Files:**
- Create: `src/generation/validate.ts`
- Test: `test/gen-validate.test.ts`

**Interfaces:**
- Consumes: `AngularFeatureModelSchema`, `evaluateAngularFeaturePolicy`, `PolicyFinding`.
- Produces: `interface ValidationResult { ok: boolean; schemaErrors: string[]; policyFindings: PolicyFinding[] }`; `validateModel(kind: string, model: unknown): ValidationResult`.

`ok` ⇔ no schema errors AND no `error`-severity policy findings.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { validateModel } from '../src/generation/validate.js';

const valid = {
  kind: 'angular-feature', templateSetVersion: 'angular-feature@v1',
  featureName: 'player-roster', selectorPrefix: 'app', route: 'players',
  viewModel: { name: 'PlayerVm', fields: [{ name: 'name', type: 'string' }] },
  i18nKeys: { de: { 'players.title': 'Aufstellung' }, en: { 'players.title': 'Roster' } },
  a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: ['axe-core'] },
  computedSignal: { id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string', purpose: 'p' },
};

describe('validateModel', () => {
  it('ok=true for a valid model', () => {
    expect(validateModel('angular-feature', valid)).toEqual({ ok: true, schemaErrors: [], policyFindings: [] });
  });
  it('ok=false with schemaErrors for a bad shape', () => {
    const r = validateModel('angular-feature', { ...valid, featureName: 'BAD' });
    expect(r.ok).toBe(false);
    expect(r.schemaErrors.length).toBeGreaterThan(0);
  });
  it('ok=false with a policy finding when a11y battery is empty (schema-valid)', () => {
    const r = validateModel('angular-feature', { ...valid, a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: [] } });
    expect(r.ok).toBe(false);
    expect(r.schemaErrors).toEqual([]);
    expect(r.policyFindings.some((f) => f.policy === 'a11y-battery-present')).toBe(true);
  });
  it('throws on an unknown kind', () => {
    expect(() => validateModel('nope', valid)).toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation**

```ts
// The validation gate: schema AND policy (D4). Returns findings; never renders.
import { AngularFeatureModelSchema } from './schemas/angular-feature.js';
import { evaluateAngularFeaturePolicy, type PolicyFinding } from './policies/angular-feature.js';

export interface ValidationResult { ok: boolean; schemaErrors: string[]; policyFindings: PolicyFinding[] }

export function validateModel(kind: string, model: unknown): ValidationResult {
  if (kind !== 'angular-feature') throw new Error(`no validator for kind: ${kind}`);
  const parsed = AngularFeatureModelSchema.safeParse(model);
  if (!parsed.success) {
    const schemaErrors = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { ok: false, schemaErrors, policyFindings: [] };
  }
  const policyFindings = evaluateAngularFeaturePolicy(parsed.data);
  const ok = policyFindings.every((f) => f.severity !== 'error');
  return { ok, schemaErrors: [], policyFindings };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): validateModel — schema + policy gate"`

---

### Task 7: Failure taxonomy + explainFailure

**Files:**
- Create: `src/generation/failure.ts`
- Test: `test/gen-failure.test.ts`

**Interfaces:**
- Produces: `FAILURE_CLASSES` tuple; `type FailureClass`; `interface FailureRecord { class: FailureClass; cause: string; remedy: string; retriable: boolean; detail?: string }`; `explainFailure(cls: FailureClass, detail?: string): FailureRecord`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { FAILURE_CLASSES, explainFailure } from '../src/generation/failure.js';

describe('failure taxonomy', () => {
  it('is the closed §4.8 set', () => {
    expect([...FAILURE_CLASSES]).toEqual(['schema-invalid', 'policy-violation', 'unknown-op', 'slot-unfilled', 'golden-drift', 'verifier-finding']);
  });
  it('every class explains a cause + remedy + retriability', () => {
    for (const c of FAILURE_CLASSES) {
      const r = explainFailure(c);
      expect(r.class).toBe(c);
      expect(r.cause.length).toBeGreaterThan(0);
      expect(r.remedy.length).toBeGreaterThan(0);
      expect(typeof r.retriable).toBe('boolean');
    }
  });
  it('golden-drift is not retriable (a template fix is required)', () => {
    expect(explainFailure('golden-drift').retriable).toBe(false);
  });
  it('threads optional detail', () => {
    expect(explainFailure('slot-unfilled', 'rosterSummary').detail).toBe('rosterSummary');
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation**

```ts
// The closed failure taxonomy (concept §4.8): every failure has a class +
// remedy + retriability, so gen_explain_failure is actionable and reconcile
// can attribute it.
export const FAILURE_CLASSES = ['schema-invalid', 'policy-violation', 'unknown-op', 'slot-unfilled', 'golden-drift', 'verifier-finding'] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export interface FailureRecord { class: FailureClass; cause: string; remedy: string; retriable: boolean; detail?: string }

const TABLE: Record<FailureClass, { cause: string; remedy: string; retriable: boolean }> = {
  'schema-invalid': { cause: "Model violates the kind's JSON Schema.", remedy: 'Fix the model shape; re-author.', retriable: true },
  'policy-violation': { cause: 'Model is schema-valid but breaks a policy.', remedy: 'Address the policy finding (e.g. add the a11y battery).', retriable: true },
  'unknown-op': { cause: 'Model references an op absent from opCatalog@vN.', remedy: 'File a gen_propose_op or move it to a logic slot.', retriable: false },
  'slot-unfilled': { cause: 'A logic slot retains its throwing stub at verify time.', remedy: 'Fill the slot body + its named unit test.', retriable: true },
  'golden-drift': { cause: 'Render diverges from the golden snapshot for an unchanged model.', remedy: 'Fix the template or bump templateSetVersion + migrate.', retriable: false },
  'verifier-finding': { cause: 'The downstream verifier wave flagged the generated artifact.', remedy: 'Address the wave finding (reuses post-findings).', retriable: true },
};

export function explainFailure(cls: FailureClass, detail?: string): FailureRecord {
  const row = TABLE[cls];
  return { class: cls, ...row, ...(detail != null ? { detail } : {}) };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): closed failure taxonomy + explainFailure"`

---

### Task 8: Context packs

**Files:**
- Create: `src/generation/context-packs/index.ts`
- Test: `test/gen-context-pack.test.ts`

**Interfaces:**
- Produces: `ContextPackSchema` (Zod), `type ContextPack`, `buildContextPack(input: { adrs?: string[]; schemas?: string[]; examples?: string[]; repoFacts?: string[] }): ContextPack`. The `hash` is `sha256(canonicalJson({adrs,schemas,examples,repoFacts}))` over **sorted** arrays — so order-independent.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildContextPack } from '../src/generation/context-packs/index.js';

describe('buildContextPack', () => {
  it('hash is independent of input array order', () => {
    const a = buildContextPack({ adrs: ['adr-176', 'adr-154'], repoFacts: ['x', 'y'] });
    const b = buildContextPack({ adrs: ['adr-154', 'adr-176'], repoFacts: ['y', 'x'] });
    expect(a.hash).toBe(b.hash);
  });
  it('defaults missing arrays to empty + still hashes', () => {
    const p = buildContextPack({});
    expect(p).toMatchObject({ adrs: [], schemas: [], examples: [], repoFacts: [] });
    expect(p.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('different content → different hash', () => {
    expect(buildContextPack({ adrs: ['adr-1'] }).hash).not.toBe(buildContextPack({ adrs: ['adr-2'] }).hash);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation**

```ts
// The hashable, content-addressed context bundle (concept §4.7). Its sha256 is
// an input to the replay key + recorded on the GenerationRun event. Arrays are
// sorted before hashing so the hash is order-independent.
import { z } from 'zod';
import { sha256Hex, canonicalJson } from '../hash.js';

export const ContextPackSchema = z.object({
  adrs: z.array(z.string()),
  schemas: z.array(z.string()),
  examples: z.array(z.string()),
  repoFacts: z.array(z.string()),
  hash: z.string(),
});
export type ContextPack = z.infer<typeof ContextPackSchema>;

export function buildContextPack(input: {
  adrs?: string[]; schemas?: string[]; examples?: string[]; repoFacts?: string[];
}): ContextPack {
  const norm = {
    adrs: [...(input.adrs ?? [])].sort(),
    schemas: [...(input.schemas ?? [])].sort(),
    examples: [...(input.examples ?? [])].sort(),
    repoFacts: [...(input.repoFacts ?? [])].sort(),
  };
  return { ...norm, hash: sha256Hex(canonicalJson(norm)) };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): hashable content-addressed context packs"`

---

### Task 9: angular-feature templateSet@v1 + renderer (golden + replay + drift)

**Files:**
- Create: `src/generation/templates/angular-feature/v1.ts`, `src/generation/renderers/angular-feature.ts`
- Test: `test/gen-render-angular-feature.test.ts`
- Golden: `test/golden/angular-feature/v1/player-roster/**` (generated once from the impl, then checked in — see Step 4)

**Interfaces:**
- Consumes: `AngularFeatureModel`, `emitSlot`, `SlotRef`, `extractSlots`.
- Produces: `interface RenderedFile { path: string; body: string }`; `renderAngularFeatureV1(model: AngularFeatureModel, contextPackHash: string): RenderedFile[]`; and the dispatch `render(model: AngularFeatureModel, templateSetVersion: string, contextPackHash: string): { files: RenderedFile[]; slots: SlotRef[] }`.

The render is PURE: identical inputs → byte-identical `RenderedFile[]`. `contextPackHash` is part of the contract (and the replay key) but `v1` does not branch the file bytes on it — documented inline; slice-2 template sets may. Output files for `player-roster` / prefix `app`:

```
players/player-roster.vm.ts
players/player-roster.logic.ts        ← the fenced computed-signal logic slot
players/player-roster.page.ts         ← standalone component; imports the slot, wraps in computed()
players/player-roster.page.html       ← <main> landmark + <h1> + i18n attrs (a11y battery)
players/player-roster.page.spec.ts    ← component test + the named slot unit test
players/player-roster.routes.ts
players/i18n/player-roster.de.json
players/i18n/player-roster.en.json
```

- [ ] **Step 1: Write the failing test (purity + structure + slot)**

```ts
import { describe, expect, it } from 'vitest';
import { render } from '../src/generation/renderers/angular-feature.js';
import type { AngularFeatureModel } from '../src/generation/schemas/angular-feature.js';

const model: AngularFeatureModel = {
  kind: 'angular-feature', templateSetVersion: 'angular-feature@v1',
  featureName: 'player-roster', selectorPrefix: 'app', route: 'players',
  viewModel: { name: 'PlayerVm', fields: [{ name: 'name', type: 'string' }, { name: 'goals', type: 'number' }] },
  i18nKeys: { de: { 'players.title': 'Aufstellung' }, en: { 'players.title': 'Roster' } },
  a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: ['axe-core', 'keyboard-nav'] },
  computedSignal: { id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string', purpose: 'one-line roster summary' },
};

describe('render(angular-feature@v1)', () => {
  it('is pure — two renders are byte-identical', () => {
    const a = render(model, 'angular-feature@v1', 'deadbeef');
    const b = render(model, 'angular-feature@v1', 'deadbeef');
    expect(a).toEqual(b);
  });
  it('emits the decomposition-aware file set', () => {
    const paths = render(model, 'angular-feature@v1', 'h').files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'players/i18n/player-roster.de.json',
      'players/i18n/player-roster.en.json',
      'players/player-roster.logic.ts',
      'players/player-roster.page.html',
      'players/player-roster.page.spec.ts',
      'players/player-roster.page.ts',
      'players/player-roster.routes.ts',
      'players/player-roster.vm.ts',
    ]);
  });
  it('the logic.ts carries the fenced throwing slot stub', () => {
    const logic = render(model, 'angular-feature@v1', 'h').files.find((f) => f.path.endsWith('.logic.ts'))!;
    expect(logic.body).toContain('// <generation:logic-slot id="rosterSummary"');
    expect(logic.body).toContain(`throw new Error('logic-slot not implemented: rosterSummary');`);
  });
  it('reports the slot', () => {
    expect(render(model, 'angular-feature@v1', 'h').slots).toEqual([{ id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string' }]);
  });
  it('the html ships the a11y landmark + heading', () => {
    const html = render(model, 'angular-feature@v1', 'h').files.find((f) => f.path.endsWith('.page.html'))!;
    expect(html.body).toContain('<main role="main"');
    expect(html.body).toContain('<h1');
  });
  it('throws on an unknown templateSetVersion', () => {
    expect(() => render(model, 'angular-feature@v2', 'h')).toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation**

`src/generation/templates/angular-feature/v1.ts` — emits the eight files as pure template literals. Key shapes (the implementer fills the full bodies to satisfy the structure assertions; use `pascal(featureName)` for class names):

```ts
import type { AngularFeatureModel } from '../../schemas/angular-feature.js';
import { emitSlot } from '../../slots.js';

export interface RenderedFile { path: string; body: string }

const pascal = (kebabName: string): string =>
  kebabName.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

export function renderAngularFeatureV1(model: AngularFeatureModel, _contextPackHash: string): RenderedFile[] {
  // _contextPackHash participates in the replay key + is recorded on the run
  // event; v1's bytes do not branch on it (documented — slice-2 sets may).
  const dir = model.route;
  const f = model.featureName;
  const Cls = pascal(f);
  const vm = model.viewModel.name;
  const slot = model.computedSignal;

  const vmFile: RenderedFile = {
    path: `${dir}/${f}.vm.ts`,
    body: `export interface ${vm} {\n${model.viewModel.fields.map((x) => `  ${x.name}: ${x.type};`).join('\n')}\n}\n`,
  };

  const logicFile: RenderedFile = {
    path: `${dir}/${f}.logic.ts`,
    body: `import type { ${vm} } from './${f}.vm.js';\n\n${emitSlot(slot)}\n`,
  };

  const pageTs: RenderedFile = {
    path: `${dir}/${f}.page.ts`,
    body:
`import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ${vm} } from './${f}.vm.js';
import { ${slot.id} } from './${f}.logic.js';

@Component({
  selector: '${model.selectorPrefix}-${f}',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './${f}.page.html',
})
export class ${Cls}Page {
  readonly players = input.required<${vm}[]>();
  readonly ${slot.id} = computed(() => ${slot.id}(this.players()));
}
`,
  };

  const pageHtml: RenderedFile = {
    path: `${dir}/${f}.page.html`,
    body:
`<main role="${model.a11yBattery.landmarkRole}" class="${f}">
  <h${model.a11yBattery.headingLevel} i18n="@@${model.route}.title">{{ '${model.route}.title' }}</h${model.a11yBattery.headingLevel}>
  <p>{{ ${slot.id}() }}</p>
</main>
`,
  };

  const slotTestName = `${slot.id} is implemented (no throwing stub)`;
  const pageSpec: RenderedFile = {
    path: `${dir}/${f}.page.spec.ts`,
    body:
`import { describe, expect, it } from 'vitest';
import { ${slot.id} } from './${f}.logic.js';

describe('${Cls}Page logic slot', () => {
  // MANDATORY named slot test (policy): the slot must be filled, not a stub.
  it('${slotTestName}', () => {
    expect(() => ${slot.id}([])).not.toThrow();
  });
});
`,
  };

  const routes: RenderedFile = {
    path: `${dir}/${f}.routes.ts`,
    body:
`import type { Routes } from '@angular/router';
import { ${Cls}Page } from './${f}.page.js';

export const ${f.replace(/-/g, '_').toUpperCase()}_ROUTES: Routes = [
  { path: '${model.route}', component: ${Cls}Page },
];
`,
  };

  const i18n = (locale: 'de' | 'en'): RenderedFile => ({
    path: `${dir}/i18n/${f}.${locale}.json`,
    body: JSON.stringify(model.i18nKeys[locale], Object.keys(model.i18nKeys[locale]).sort(), 2) + '\n',
  });

  return [vmFile, logicFile, pageTs, pageHtml, pageSpec, routes, i18n('de'), i18n('en')];
}
```

`src/generation/renderers/angular-feature.ts`:

```ts
import type { AngularFeatureModel } from '../schemas/angular-feature.js';
import { renderAngularFeatureV1, type RenderedFile } from '../templates/angular-feature/v1.js';
import { extractSlots, type SlotRef } from '../slots.js';

export type { RenderedFile };

const TEMPLATE_SETS: ReadonlyMap<string, (m: AngularFeatureModel, h: string) => RenderedFile[]> = new Map([
  ['angular-feature@v1', renderAngularFeatureV1],
]);

export function render(model: AngularFeatureModel, templateSetVersion: string, contextPackHash: string): { files: RenderedFile[]; slots: SlotRef[] } {
  const fn = TEMPLATE_SETS.get(templateSetVersion);
  if (!fn) throw new Error(`unknown templateSetVersion: ${templateSetVersion}`);
  const files = fn(model, contextPackHash);
  const slots = files.flatMap((file) => extractSlots(file.body));
  return { files, slots };
}
```

> **Note on `JSON.stringify(obj, sortedKeys, 2)`**: passing a key array as the replacer both filters and orders keys deterministically.

- [ ] **Step 4: Run the structure/purity tests → PASS. Then write the golden snapshot test + materialize the golden tree.**

Add to `test/gen-render-angular-feature.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GOLDEN = join(__dirname, 'golden/angular-feature/v1/player-roster');

function walk(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    return statSync(p).isDirectory() ? walk(p, rel) : [rel];
  });
}

describe('golden snapshot (drift guard)', () => {
  it('render matches the checked-in golden tree byte-for-byte', () => {
    const { files } = render(model, 'angular-feature@v1', 'fixed-context-hash');
    // every rendered file equals its golden, and there are no extra/missing files
    const goldenRel = walk(GOLDEN).map((r) => r.replace(/\\/g, '/')).sort();
    expect(files.map((f) => f.path).sort()).toEqual(goldenRel);
    for (const file of files) {
      const expected = readFileSync(join(GOLDEN, file.path), 'utf8');
      expect(file.body).toBe(expected); // a template change w/o a version bump turns THIS red (golden-drift)
    }
  });
});
```

Materialize the golden tree by writing each rendered file's exact body to `test/golden/angular-feature/v1/player-roster/<path>` (do this with a one-off script, then DELETE the script and commit the tree). Verify the golden test passes.

- [ ] **Step 5: Commit**

```bash
git add src/generation/templates src/generation/renderers test/gen-render-angular-feature.test.ts test/golden
git commit -m "feat(gen): angular-feature templateSet@v1 renderer + golden/replay/drift tests"
```

---

### Task 10: Foundry events — GenerationRun + ArtifactGenerated

**Files:**
- Modify: `src/scope.ts` (add `genRunAggregateId`), `src/events.ts` (add EVENT entries, payload schemas, constructors)
- Test: `test/gen-events.test.ts`

**Interfaces:**
- Produces (in `events.ts`): `EVENT.GENERATION_RUN = 'foundry:GenerationRun.v1'`, `EVENT.ARTIFACT_GENERATED = 'foundry:ArtifactGenerated.v1'`; `generationRun(i)`, `artifactGenerated(i)` constructors; payload types `GenerationRunPayload`, `ArtifactGeneratedPayload`. (in `scope.ts`): `genRunAggregateId(runId: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { EVENT, generationRun, artifactGenerated } from '../src/events.js';
import { genRunAggregateId } from '../src/scope.js';

const TS = '2026-06-25T12:00:00.000Z';

describe('generationRun event', () => {
  it('builds a validated GenerationRun envelope', () => {
    const e = generationRun({
      runId: 'run-1', kind: 'angular-feature', mode: 'bounded',
      modelHash: 'm', templateSetVersion: 'angular-feature@v1', contextPackHash: 'c',
      claimRef: 'de-braighter/foundry#1', ts: TS,
    });
    expect(e.eventType).toBe(EVENT.GENERATION_RUN);
    expect(e.aggregateType).toBe('GenerationRun');
    expect(e.aggregateId).toBe(genRunAggregateId('run-1'));
    expect(e.metadata.actorRef).toBe('foundry:generation');
    expect(e.payload).toMatchObject({ runId: 'run-1', kind: 'angular-feature', mode: 'bounded', claimRef: 'de-braighter/foundry#1' });
  });
  it('rejects an unknown mode', () => {
    expect(() => generationRun({ runId: 'r', kind: 'k', mode: 'wild' as never, modelHash: 'm', templateSetVersion: 't', contextPackHash: 'c', claimRef: 'x', ts: TS })).toThrow();
  });
});

describe('artifactGenerated event', () => {
  it('builds a validated ArtifactGenerated envelope sharing the run aggregate', () => {
    const e = artifactGenerated({
      runId: 'run-1', kind: 'angular-feature',
      files: [{ path: 'a.ts', bytes: 10 }], slots: [{ id: 'rosterSummary', filled: true, testRef: 'a.spec.ts' }], ts: TS,
    });
    expect(e.eventType).toBe(EVENT.ARTIFACT_GENERATED);
    expect(e.aggregateId).toBe(genRunAggregateId('run-1'));
    expect(e.payload).toMatchObject({ files: [{ path: 'a.ts', bytes: 10 }] });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation**

In `src/scope.ts` add:

```ts
export const genRunAggregateId = (runId: string): string => uuidv5(`gen-run:${runId}`);
```

In `src/events.ts` add to the `EVENT` const:

```ts
  GENERATION_RUN: 'foundry:GenerationRun.v1',
  ARTIFACT_GENERATED: 'foundry:ArtifactGenerated.v1',
```

Add the modes import + payload schemas + constructors (place near the other payload schemas; import `genRunAggregateId` from `./scope.js` and `GENERATION_MODES` from `./generation/modes.js`):

```ts
import { genRunAggregateId } from './scope.js';            // extend existing scope import
import { GENERATION_MODES } from './generation/modes.js';

const GenerationRun = z.object({
  runId: z.string().min(1), kind: z.string().min(1), mode: z.enum(GENERATION_MODES),
  modelHash: z.string().min(1), templateSetVersion: z.string().min(1),
  contextPackHash: z.string().min(1), claimRef: z.string().min(1),
});
const ArtifactGenerated = z.object({
  runId: z.string().min(1), kind: z.string().min(1),
  files: z.array(z.object({ path: z.string().min(1), bytes: z.number().int().nonnegative() })),
  slots: z.array(z.object({ id: z.string().min(1), filled: z.boolean(), testRef: z.string().optional() })),
});

export type GenerationRunPayload = z.infer<typeof GenerationRun>;
export type ArtifactGeneratedPayload = z.infer<typeof ArtifactGenerated>;

/** A generation run — the deterministic-render provenance (modelHash + templateSetVersion
 *  + contextPackHash = the replay key), coupled to the Foundry claim that produced it. */
export const generationRun = (i: z.input<typeof GenerationRun> & { ts: string }) =>
  envelope(EVENT.GENERATION_RUN, 'GenerationRun', genRunAggregateId(i.runId), i.ts, GenerationRun.parse(i), 'foundry:generation');

/** The artifact a run produced — files + logic-slot fill status. Shares the run aggregate. */
export const artifactGenerated = (i: z.input<typeof ArtifactGenerated> & { ts: string }) =>
  envelope(EVENT.ARTIFACT_GENERATED, 'GenerationRun', genRunAggregateId(i.runId), i.ts, ArtifactGenerated.parse(i), 'foundry:generation');
```

> Import hygiene: `events.ts` already imports several names from `./scope.js` — add `genRunAggregateId` to that existing import line rather than a second import.

- [ ] **Step 4: Run → PASS.** Also run the full suite to confirm no regression: `npx vitest run test/events.test.ts test/gen-events.test.ts`.
- [ ] **Step 5: Commit** — `git commit -m "feat(events): additive GenerationRun + ArtifactGenerated foundry events (D6)"`

---

### Task 11: generate + preview (write + event coupling)

**Files:**
- Create: `src/generation/preview.ts`, `src/generation/generate.ts`
- Test: `test/gen-generate.acid.test.ts`

**Interfaces:**
- Consumes: `validateModel`, `render`, `hashModel`, `buildContextPack`, `generationRun`, `artifactGenerated`, `append`, `isSlotFilled`, `GENERATION_KINDS`.
- Produces:
  - `interface PreviewResult { files: RenderedFile[]; slots: SlotRef[]; mode: GenerationMode }`; `preview(kind: string, model: unknown): PreviewResult`.
  - `interface GenerateDeps { logPath: string; outDir: string; now?: () => string; newId?: () => string }`;
  - `interface GeneratedArtifactReport { runId, kind, mode, modelHash, templateSetVersion, contextPackHash, claimRef, files: {path,bytes}[], slots: {id,filled,testRef?}[], findings: FailureRecord[], reproducible: boolean }`;
  - `generate(deps: GenerateDeps, input: { kind: string; model: unknown; claimRef: string; contextPack?: ContextPack }): GeneratedArtifactReport`.

`generate` flow: validate → throw on `!ok` (schema-invalid/policy-violation) → build/accept context pack → render → write files under `outDir` → append `generationRun` then `artifactGenerated` to `logPath` → return report. `preview` renders only (no write, no events).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview } from '../src/generation/preview.js';
import { generate } from '../src/generation/generate.js';
import { readEnvelopes } from '../src/log.js';
import { EVENT } from '../src/events.js';

const model = {
  kind: 'angular-feature', templateSetVersion: 'angular-feature@v1',
  featureName: 'player-roster', selectorPrefix: 'app', route: 'players',
  viewModel: { name: 'PlayerVm', fields: [{ name: 'name', type: 'string' }] },
  i18nKeys: { de: { 'players.title': 'Aufstellung' }, en: { 'players.title': 'Roster' } },
  a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: ['axe-core'] },
  computedSignal: { id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string', purpose: 'p' },
};

const fixedDeps = (dir: string) => ({
  logPath: join(dir, 'events.jsonl'),
  outDir: join(dir, 'out'),
  now: () => '2026-06-25T00:00:00.000Z',
  newId: () => 'run-fixed',
});

describe('preview', () => {
  it('renders without writing files or events', () => {
    const r = preview('angular-feature', model);
    expect(r.mode).toBe('bounded');
    expect(r.files.length).toBe(8);
    expect(r.slots).toEqual([{ id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string' }]);
  });
  it('throws on an invalid model', () => {
    expect(() => preview('angular-feature', { ...model, a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: [] } })).toThrow();
  });
});

describe('generate', () => {
  it('writes files + appends the two events coupled to the claimRef', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-'));
    const deps = fixedDeps(dir);
    const report = generate(deps, { kind: 'angular-feature', model, claimRef: 'de-braighter/foundry#1' });

    expect(report.runId).toBe('run-fixed');
    expect(report.mode).toBe('bounded');
    expect(existsSync(join(deps.outDir, 'players/player-roster.page.ts'))).toBe(true);

    const events = readEnvelopes(deps.logPath);
    const types = events.map((e) => e.eventType);
    expect(types).toContain(EVENT.GENERATION_RUN);
    expect(types).toContain(EVENT.ARTIFACT_GENERATED);
    const run = events.find((e) => e.eventType === EVENT.GENERATION_RUN)!;
    expect(run.payload).toMatchObject({ claimRef: 'de-braighter/foundry#1', templateSetVersion: 'angular-feature@v1' });
  });
  it('is replay-stable: same inputs → identical modelHash + file bytes', () => {
    const d1 = mkdtempSync(join(tmpdir(), 'gen-'));
    const d2 = mkdtempSync(join(tmpdir(), 'gen-'));
    const r1 = generate(fixedDeps(d1), { kind: 'angular-feature', model, claimRef: 'c' });
    const r2 = generate(fixedDeps(d2), { kind: 'angular-feature', model, claimRef: 'c' });
    expect(r1.modelHash).toBe(r2.modelHash);
    expect(r1.contextPackHash).toBe(r2.contextPackHash);
    expect(readFileSync(join(d1, 'out/players/player-roster.page.ts'), 'utf8'))
      .toBe(readFileSync(join(d2, 'out/players/player-roster.page.ts'), 'utf8'));
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation**

`src/generation/preview.ts`:

```ts
import { validateModel } from './validate.js';
import { render, type RenderedFile } from './renderers/angular-feature.js';
import { buildContextPack } from './context-packs/index.js';
import { GENERATION_KINDS, type GenerationKind } from './kinds.js';
import type { GenerationMode } from './modes.js';
import type { SlotRef } from './slots.js';
import type { AngularFeatureModel } from './schemas/angular-feature.js';

export interface PreviewResult { files: RenderedFile[]; slots: SlotRef[]; mode: GenerationMode }

export function preview(kind: string, model: unknown): PreviewResult {
  const v = validateModel(kind, model);
  if (!v.ok) {
    const detail = [...v.schemaErrors, ...v.policyFindings.map((f) => `${f.policy}: ${f.message}`)].join('; ');
    throw new Error(`invalid model: ${detail}`);
  }
  const info = GENERATION_KINDS.get(kind as GenerationKind);
  if (!info) throw new Error(`unknown kind: ${kind}`);
  const m = model as AngularFeatureModel;
  const contextPackHash = buildContextPack({ schemas: [info.schemaRef] }).hash;
  const { files, slots } = render(m, m.templateSetVersion, contextPackHash);
  return { files, slots, mode: info.mode };
}
```

`src/generation/generate.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { append } from '../log.js';
import { generationRun, artifactGenerated } from '../events.js';
import { validateModel } from './validate.js';
import { render } from './renderers/angular-feature.js';
import { hashModel } from './hash.js';
import { buildContextPack, type ContextPack } from './context-packs/index.js';
import { GENERATION_KINDS, type GenerationKind } from './kinds.js';
import { isSlotFilled } from './slots.js';
import type { GenerationMode } from './modes.js';
import type { FailureRecord } from './failure.js';
import type { AngularFeatureModel } from './schemas/angular-feature.js';

export interface GenerateDeps { logPath: string; outDir: string; now?: () => string; newId?: () => string }

export interface GeneratedArtifactReport {
  runId: string; kind: string; mode: GenerationMode; modelHash: string;
  templateSetVersion: string; contextPackHash: string; claimRef: string;
  files: { path: string; bytes: number }[];
  slots: { id: string; filled: boolean; testRef?: string }[];
  findings: FailureRecord[]; reproducible: boolean;
}

export function generate(
  deps: GenerateDeps,
  input: { kind: string; model: unknown; claimRef: string; contextPack?: ContextPack },
): GeneratedArtifactReport {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());

  const v = validateModel(input.kind, input.model);
  if (!v.ok) {
    const detail = [...v.schemaErrors, ...v.policyFindings.map((f) => `${f.policy}: ${f.message}`)].join('; ');
    throw new Error(`cannot generate — invalid model: ${detail}`);
  }
  const info = GENERATION_KINDS.get(input.kind as GenerationKind);
  if (!info) throw new Error(`unknown kind: ${input.kind}`);

  const model = input.model as AngularFeatureModel;
  const pack = input.contextPack ?? buildContextPack({ schemas: [info.schemaRef] });
  const modelHash = hashModel(model);
  const { files, slots } = render(model, model.templateSetVersion, pack.hash);

  // write the rendered tree under outDir
  for (const file of files) {
    const abs = join(deps.outDir, file.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.body, 'utf8');
  }

  const runId = newId();
  const ts = now();
  const fileReport = files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.body, 'utf8') }));
  const slotReport = slots.map((s) => {
    const logic = files.find((f) => f.path.endsWith('.logic.ts'));
    return { id: s.id, filled: logic ? isSlotFilled(logic.body, s.id) : false, testRef: `${model.route}/${model.featureName}.page.spec.ts` };
  });

  append(generationRun({ runId, kind: input.kind, mode: info.mode, modelHash, templateSetVersion: model.templateSetVersion, contextPackHash: pack.hash, claimRef: input.claimRef, ts }), deps.logPath);
  append(artifactGenerated({ runId, kind: input.kind, files: fileReport, slots: slotReport, ts }), deps.logPath);

  return { runId, kind: input.kind, mode: info.mode, modelHash, templateSetVersion: model.templateSetVersion, contextPackHash: pack.hash, claimRef: input.claimRef, files: fileReport, slots: slotReport, findings: [], reproducible: true };
}
```

- [ ] **Step 4: Run → PASS** (and full suite: `npx vitest run`).
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): generate + preview — deterministic render, write, event coupling (D6)"`

---

### Task 12: verifyArtifact

**Files:**
- Create: `src/generation/verify.ts`
- Test: `test/gen-verify.test.ts`

**Interfaces:**
- Consumes: `GeneratedArtifactReport`, `render`, `isSlotFilled`, `explainFailure`.
- Produces: `verifyArtifact(deps: { outDir: string }, report: GeneratedArtifactReport): { ok: boolean; findings: FailureRecord[] }`.

Checks: (1) every slot in the report is `filled` (else `slot-unfilled`); (2) `reproducible` — re-render `(model-derived files)` — slice 1 asserts the report's own `reproducible` flag is true (the byte-identical re-render is proven by the render purity + golden tests). Returns `ok` ⇔ no findings.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { verifyArtifact } from '../src/generation/verify.js';
import type { GeneratedArtifactReport } from '../src/generation/generate.js';

const base: GeneratedArtifactReport = {
  runId: 'r', kind: 'angular-feature', mode: 'bounded', modelHash: 'm',
  templateSetVersion: 'angular-feature@v1', contextPackHash: 'c', claimRef: 'x',
  files: [{ path: 'players/player-roster.page.ts', bytes: 100 }],
  slots: [{ id: 'rosterSummary', filled: true, testRef: 's' }],
  findings: [], reproducible: true,
};

describe('verifyArtifact', () => {
  it('ok when slots filled + reproducible', () => {
    expect(verifyArtifact({ outDir: '/tmp' }, base)).toEqual({ ok: true, findings: [] });
  });
  it('slot-unfilled finding when a slot keeps its stub', () => {
    const r = verifyArtifact({ outDir: '/tmp' }, { ...base, slots: [{ id: 'rosterSummary', filled: false }] });
    expect(r.ok).toBe(false);
    expect(r.findings[0]!.class).toBe('slot-unfilled');
  });
  it('golden-drift finding when not reproducible', () => {
    const r = verifyArtifact({ outDir: '/tmp' }, { ...base, reproducible: false });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.class === 'golden-drift')).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation**

```ts
// Verifier-hooks (concept §4.8): the SDK-side checks before the artifact is
// accepted — slot-filled + reproducibility — classified into the closed taxonomy.
import { explainFailure, type FailureRecord } from './failure.js';
import type { GeneratedArtifactReport } from './generate.js';

export function verifyArtifact(_deps: { outDir: string }, report: GeneratedArtifactReport): { ok: boolean; findings: FailureRecord[] } {
  const findings: FailureRecord[] = [];
  for (const slot of report.slots) {
    if (!slot.filled) findings.push(explainFailure('slot-unfilled', slot.id));
  }
  if (!report.reproducible) findings.push(explainFailure('golden-drift'));
  return { ok: findings.length === 0, findings };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): verifyArtifact — slot-filled + reproducibility hooks"`

---

### Task 13: op-catalog stub, proposeOp stub, SDK barrel

**Files:**
- Create: `src/generation/op-catalog/index.ts`, `src/generation/propose.ts`, `src/generation/index.ts`
- Test: extend `test/gen-validate.test.ts` is unnecessary; add `test/gen-sdk-barrel.test.ts`

**Interfaces:**
- `describeOpCatalog(kind: string, version?: string): { kind: string; version: string; ops: { op: string; signature: string }[] }` — slice-1 minimal illustrative set with a `// TODO(slice-2)` note; the crux curation is slice 2.
- `proposeOp(input: { kind: string; proposedOp: string; usageSites: string[] }): { proposalId: string }` — slice-1 thin: returns a deterministic-ish id; `// TODO(slice-2)` route to human curation.
- `src/generation/index.ts` — re-export the public API.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import * as sdk from '../src/generation/index.js';

describe('SDK public barrel', () => {
  it('exposes the slice-1 public API', () => {
    for (const name of ['listKinds', 'describeSchema', 'describeOpCatalog', 'validateModel', 'preview', 'generate', 'verifyArtifact', 'explainFailure', 'buildContextPack', 'proposeOp']) {
      expect(typeof (sdk as Record<string, unknown>)[name]).toBe('function');
    }
  });
  it('describeOpCatalog returns a versioned op list for angular-feature', () => {
    const cat = sdk.describeOpCatalog('angular-feature');
    expect(cat.kind).toBe('angular-feature');
    expect(cat.version).toMatch(/opCatalog@v/);
    expect(Array.isArray(cat.ops)).toBe(true);
  });
  it('proposeOp returns a proposalId', () => {
    expect(sdk.proposeOp({ kind: 'angular-feature', proposedOp: 'paginate', usageSites: ['a', 'b'] }).proposalId).toMatch(/^op-proposal-/);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation**

`src/generation/op-catalog/index.ts`:

```ts
// The closed operation catalog (concept §4.2, R2). Slice 1 ships a MINIMAL
// illustrative set; curating opCatalog@v1 + the catalog-versioning policy is
// the slice-2 crux (its own ADR, OQ-3) — do not grow it here.
// TODO(slice-2): curate the real opCatalog@v1 for service-method.
export function describeOpCatalog(kind: string, version = 'opCatalog@v1'): { kind: string; version: string; ops: { op: string; signature: string }[] } {
  if (kind !== 'angular-feature') throw new Error(`no op catalog for kind: ${kind}`);
  return {
    kind, version,
    ops: [
      { op: 'logic-slot', signature: '(id, inputs, output) → fenced typed hole' },
    ],
  };
}
```

`src/generation/propose.ts`:

```ts
import { sha256Hex } from './hash.js';

// Catalog-extension proposal channel (R6). Slice 1 is thin: it records the
// proposal id deterministically; routing to human curation is slice 2.
// TODO(slice-2): persist the proposal + route to curation.
export function proposeOp(input: { kind: string; proposedOp: string; usageSites: string[] }): { proposalId: string } {
  const id = sha256Hex(`${input.kind}:${input.proposedOp}:${[...input.usageSites].sort().join(',')}`).slice(0, 12);
  return { proposalId: `op-proposal-${id}` };
}
```

`src/generation/index.ts`:

```ts
// The stable Generation SDK public API (concept §4.6). The gen_* MCP imports
// ONLY this surface (D5). Foundry-internal for slice 1 (OQ-4 defers publication).
export { listKinds, GENERATION_KINDS, type GenerationKind, type GenerationKindInfo } from './kinds.js';
export { GENERATION_MODES, type GenerationMode } from './modes.js';
export { describeSchema, AngularFeatureModelSchema, type AngularFeatureModel } from './schemas/angular-feature.js';
export { describeOpCatalog } from './op-catalog/index.js';
export { validateModel, type ValidationResult } from './validate.js';
export { evaluateAngularFeaturePolicy, type PolicyFinding } from './policies/angular-feature.js';
export { preview, type PreviewResult } from './preview.js';
export { generate, type GenerateDeps, type GeneratedArtifactReport } from './generate.js';
export { verifyArtifact } from './verify.js';
export { explainFailure, FAILURE_CLASSES, type FailureClass, type FailureRecord } from './failure.js';
export { buildContextPack, ContextPackSchema, type ContextPack } from './context-packs/index.js';
export { proposeOp } from './propose.js';
export { render, type RenderedFile } from './renderers/angular-feature.js';
export { type SlotRef } from './slots.js';
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): op-catalog stub + proposeOp + SDK public barrel"`

---

### Task 14: gen_* MCP tools

**Files:**
- Create: `src/mcp/gen-tools.ts`
- Modify: `src/mcp/server.ts` (register the gen_* tools)
- Test: `test/gen-mcp.test.ts`

**Interfaces:**
- Consumes: the SDK barrel (`../generation/index.js`), the `append`/`log` deps shape used by `makeTools`.
- Produces: `makeGenTools(deps: { logPath: string; dataDir: string; now?: () => string; newId?: () => string }): Record<string, (a: any) => Promise<CallToolResult>>` with keys `gen_list_kinds`, `gen_describe_schema`, `gen_describe_op_catalog`, `gen_validate_model`, `gen_preview`, `gen_generate`, `gen_verify_artifact`, `gen_explain_failure`, `gen_propose_op`.

Reuse the existing `ok`/`fail`/`guard` pattern (copy the tiny helpers, or export them from `tools.ts`). `gen_generate` writes under `deps.dataDir/generated/<runId>` by default and logs to `deps.logPath`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGenTools } from '../src/mcp/gen-tools.js';

const model = {
  kind: 'angular-feature', templateSetVersion: 'angular-feature@v1',
  featureName: 'player-roster', selectorPrefix: 'app', route: 'players',
  viewModel: { name: 'PlayerVm', fields: [{ name: 'name', type: 'string' }] },
  i18nKeys: { de: { 'players.title': 'Aufstellung' }, en: { 'players.title': 'Roster' } },
  a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: ['axe-core'] },
  computedSignal: { id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string', purpose: 'p' },
};

const tools = () => {
  const dir = mkdtempSync(join(tmpdir(), 'genmcp-'));
  return makeGenTools({ logPath: join(dir, 'events.jsonl'), dataDir: dir, now: () => '2026-06-25T00:00:00.000Z', newId: () => 'run-x' });
};

describe('gen_* MCP', () => {
  it('gen_list_kinds lists angular-feature', async () => {
    const r = await tools().gen_list_kinds({});
    expect(r.content[0]!.text).toContain('angular-feature');
  });
  it('gen_validate_model returns a policy finding for an empty a11y battery (isError false — it is a read result)', async () => {
    const r = await tools().gen_validate_model({ kind: 'angular-feature', model: { ...model, a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: [] } } });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]!.text).toContain('a11y-battery-present');
  });
  it('gen_generate emits events + returns the runId', async () => {
    const r = await tools().gen_generate({ kind: 'angular-feature', model, claimRef: 'de-braighter/foundry#1' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]!.text).toContain('run-x');
  });
  it('a bad model surfaces as isError (never a throw)', async () => {
    const r = await tools().gen_generate({ kind: 'angular-feature', model: { ...model, featureName: 'BAD' }, claimRef: 'c' });
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write implementation** (mirror `tools.ts` `ok`/`fail`/`guard`):

```ts
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import * as sdk from '../generation/index.js';

const ok = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (e: unknown): CallToolResult => ({
  content: [{ type: 'text', text: e instanceof ZodError ? `ERROR: invalid input — ${e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}` : `ERROR: ${(e as Error).message}` }],
  isError: true,
});
function guard<A extends unknown[]>(fn: (...a: A) => unknown) {
  return async (...a: A): Promise<CallToolResult> => { try { return ok(await fn(...a)); } catch (e) { return fail(e); } };
}

export interface GenToolDeps { logPath: string; dataDir: string; now?: () => string; newId?: () => string }

export function makeGenTools(deps: GenToolDeps) {
  return {
    gen_list_kinds: guard((_a: Record<string, never>) => sdk.listKinds()),
    gen_describe_schema: guard((a: { kind: string }) => sdk.describeSchema(a.kind)),
    gen_describe_op_catalog: guard((a: { kind: string; version?: string }) => sdk.describeOpCatalog(a.kind, a.version)),
    gen_validate_model: guard((a: { kind: string; model: unknown }) => sdk.validateModel(a.kind, a.model)),
    gen_preview: guard((a: { kind: string; model: unknown }) => sdk.preview(a.kind, a.model)),
    gen_generate: guard((a: { kind: string; model: unknown; claimRef: string }) => {
      const report = sdk.generate({ logPath: deps.logPath, outDir: join(deps.dataDir, 'generated'), now: deps.now, newId: deps.newId }, a);
      return report;
    }),
    gen_verify_artifact: guard((a: { report: sdk.GeneratedArtifactReport }) => sdk.verifyArtifact({ outDir: join(deps.dataDir, 'generated') }, a.report)),
    gen_explain_failure: guard((a: { class: sdk.FailureClass; detail?: string }) => sdk.explainFailure(a.class, a.detail)),
    gen_propose_op: guard((a: { kind: string; proposedOp: string; usageSites: string[] }) => sdk.proposeOp(a)),
  };
}
```

In `src/mcp/server.ts`, after the foundry tools are registered, add (import `makeGenTools` + register each with a Zod input shape):

```ts
import { makeGenTools } from './gen-tools.js';
// ... inside main(), after `const tools = makeTools(...)`:
const gen = makeGenTools({ dataDir: DEFAULT_DATA_DIR, logPath: DEFAULT_LOG });

server.registerTool('gen_list_kinds', { description: 'Enumerate generation kinds (kind, default mode, schemaRef, neverAiFree).', inputSchema: {} }, async () => gen.gen_list_kinds({}));
server.registerTool('gen_describe_schema', { description: "Return the JSON Schema for a generation kind's metamodel.", inputSchema: { kind: z.string().min(1) } }, async (a) => gen.gen_describe_schema(a));
server.registerTool('gen_describe_op_catalog', { description: 'Return the closed operation catalog for a kind (slice 1: minimal; crux is slice 2).', inputSchema: { kind: z.string().min(1), version: z.string().optional() } }, async (a) => gen.gen_describe_op_catalog(a));
server.registerTool('gen_validate_model', { description: 'Validate a model against schema AND policy without generating. Returns { ok, schemaErrors, policyFindings }.', inputSchema: { kind: z.string().min(1), model: z.unknown() } }, async (a) => gen.gen_validate_model(a as { kind: string; model: unknown }));
server.registerTool('gen_preview', { description: 'Dry-run render: returns files + logic slots + mode. No write, no event.', inputSchema: { kind: z.string().min(1), model: z.unknown() } }, async (a) => gen.gen_preview(a as { kind: string; model: unknown }));
server.registerTool('gen_generate', { description: 'Validate → render → write files → emit GenerationRun + ArtifactGenerated coupled to a Foundry claimRef.', inputSchema: { kind: z.string().min(1), model: z.unknown(), claimRef: z.string().min(1) } }, async (a) => gen.gen_generate(a as { kind: string; model: unknown; claimRef: string }));
server.registerTool('gen_verify_artifact', { description: 'Run SDK verifier-hooks (slot-filled + reproducibility) on a generation report.', inputSchema: { report: z.unknown() } }, async (a) => gen.gen_verify_artifact(a as { report: sdk.GeneratedArtifactReport }));
server.registerTool('gen_explain_failure', { description: 'Explain a generation failure class: cause, remedy, retriability.', inputSchema: { class: z.string().min(1), detail: z.string().optional() } }, async (a) => gen.gen_explain_failure(a as { class: sdk.FailureClass; detail?: string }));
server.registerTool('gen_propose_op', { description: 'File a catalog-extension proposal (R6). Routes to human curation; never auto-extends.', inputSchema: { kind: z.string().min(1), proposedOp: z.string().min(1), usageSites: z.array(z.string()) } }, async (a) => gen.gen_propose_op(a));
```

(Add `import * as sdk from '../generation/index.js';` to server.ts for the `sdk.*` type casts, or inline the casts.)

- [ ] **Step 4: Run → PASS** (`npx vitest run test/gen-mcp.test.ts`). server.ts is coverage-excluded, so no coverage hit from the registrations.
- [ ] **Step 5: Commit** — `git commit -m "feat(gen): gen_* MCP surface delegating to the Generation SDK (D5)"`

---

### Task 15: End-to-end acceptance — the 8 slice-1 criteria

**Files:**
- Create: `test/gen-e2e.acid.test.ts`

This single test file asserts the concept §8 "Slice 1 acceptance (must bite)" criteria as one coherent flow, proving the loop closes.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listKinds, describeSchema, validateModel, preview, generate, verifyArtifact } from '../src/generation/index.js';
import { readEnvelopes } from '../src/log.js';
import { EVENT } from '../src/events.js';

const model = {
  kind: 'angular-feature', templateSetVersion: 'angular-feature@v1',
  featureName: 'player-roster', selectorPrefix: 'app', route: 'players',
  viewModel: { name: 'PlayerVm', fields: [{ name: 'name', type: 'string' }] },
  i18nKeys: { de: { 'players.title': 'Aufstellung' }, en: { 'players.title': 'Roster' } },
  a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: ['axe-core'] },
  computedSignal: { id: 'rosterSummary', inputs: 'players: PlayerVm[]', output: 'string', purpose: 'p' },
};

describe('slice-1 acceptance — the loop closes', () => {
  it('1. list_kinds advertises angular-feature/bounded', () => {
    expect(listKinds().find((k) => k.kind === 'angular-feature')?.mode).toBe('bounded');
  });
  it('2. describe_schema returns the metamodel JSON Schema', () => {
    expect((describeSchema('angular-feature') as { $id: string }).$id).toBe('angular-feature@v1');
  });
  it('3. validate rejects a model missing the a11y battery with a policy-violation', () => {
    const r = validateModel('angular-feature', { ...model, a11yBattery: { landmarkRole: 'main', headingLevel: 1, checks: [] } });
    expect(r.ok).toBe(false);
    expect(r.policyFindings.some((f) => f.policy === 'a11y-battery-present')).toBe(true);
  });
  it('4. preview is deterministic — two previews are byte-identical', () => {
    expect(preview('angular-feature', model)).toEqual(preview('angular-feature', model));
  });
  it('5. generate writes files + emits GenerationRun + ArtifactGenerated coupled to claimRef', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    const deps = { logPath: join(dir, 'events.jsonl'), outDir: join(dir, 'out'), now: () => '2026-06-25T00:00:00.000Z', newId: () => 'run-e2e' };
    const report = generate(deps, { kind: 'angular-feature', model, claimRef: 'de-braighter/foundry#42' });
    const events = readEnvelopes(deps.logPath);
    expect(events.map((e) => e.eventType)).toEqual([EVENT.GENERATION_RUN, EVENT.ARTIFACT_GENERATED]);
    expect((events[0]!.payload as { claimRef: string }).claimRef).toBe('de-braighter/foundry#42');
    // 6. verify ok
    // (slot filled in the report by construction? No — the stub is unfilled; verify SHOULD flag it,
    //  proving the slot-filled gate bites. We fill the slot then re-verify.)
    expect(verifyArtifact({ outDir: deps.outDir }, report).ok).toBe(false); // unfilled stub flagged
    const filledReport = { ...report, slots: report.slots.map((s) => ({ ...s, filled: true })) };
    expect(verifyArtifact({ outDir: deps.outDir }, filledReport).ok).toBe(true);
    // 8. replay — same inputs reproduce identical bytes
    const dir2 = mkdtempSync(join(tmpdir(), 'e2e-'));
    const deps2 = { ...deps, logPath: join(dir2, 'events.jsonl'), outDir: join(dir2, 'out') };
    const report2 = generate(deps2, { kind: 'angular-feature', model, claimRef: 'de-braighter/foundry#42' });
    expect(report2.modelHash).toBe(report.modelHash);
    expect(readFileSync(join(deps.outDir, 'players/player-roster.page.ts'), 'utf8'))
      .toBe(readFileSync(join(deps2.outDir, 'players/player-roster.page.ts'), 'utf8'));
  });
});
```

> Criterion 7 (golden-drift RED on an un-versioned template change) is covered by the golden test in Task 9; this e2e file references that guarantee rather than duplicating the golden tree.

- [ ] **Step 2: Run → PASS** (`npx vitest run test/gen-e2e.acid.test.ts`).
- [ ] **Step 3: Full gate** — `npm run ci:local` (typecheck + coverage). Expect all green; coverage on `src/generation/**` should be high (pure modules).
- [ ] **Step 4: Commit** — `git commit -m "test(gen): slice-1 end-to-end acceptance — the loop closes"`

---

## Self-Review

**Spec coverage (ADR-274 D-numbers + concept §8 acceptance):**
- D1 (AI authors models) — the metamodel schema (Task 4) is the only AI-facing contract; ✓.
- D2 (closed surface + one logic slot) — slots.ts (Task 3) + the single `computedSignal` slot; op-catalog stub defers the crux to slice 2 with a TODO; ✓.
- D3 (determinism) — render purity + golden + replay (Tasks 9, 11, 15); ✓.
- D4 (policy gate) — Tasks 5–6; ✓.
- D5 (MCP↔SDK boundary) — gen-tools.ts delegates to the SDK barrel only (Tasks 13–14); ✓.
- D6 (event-sourced runs) — Tasks 10–11 emit the two additive Foundry events into the existing log coupled to `claimRef`; ✓.
- D7 (angular-feature first slice on a deterministic renderer) — Task 9 (templateSet@v1, not a stateful nx schematic — the reconciliation is documented in Architecture + Global Constraints); ✓.
- Concept §8 acceptance 1–8 — Task 15 (+ Task 9 golden for #7); ✓.

**Placeholder scan:** No "TBD"/"implement later" in code steps. The two `// TODO(slice-2)` notes (op-catalog curation, proposeOp persistence) are *intentional, ADR-sanctioned* deferrals (OQ-3/R6), not plan placeholders — slice 1 explicitly does not settle the catalog crux.

**Type consistency:** `RenderedFile` (Task 9) consumed by Tasks 11/14; `GeneratedArtifactReport` (Task 11) consumed by Tasks 12/14/15; `FailureRecord`/`FailureClass` (Task 7) consumed by Tasks 11/12/13/14; `PolicyFinding` (Task 5) consumed by Tasks 6/13; `genRunAggregateId` (Task 10 scope.ts) consumed by Task 10 events + test. `generate` signature is `generate(deps, { kind, model, claimRef })` everywhere. ✓.

## Execution note

Per the founder's standing instruction (always subagent-driven execution) this plan executes via **superpowers:subagent-driven-development**: a fresh subagent per task with a two-stage review between tasks, all inside a single isolated git worktree off `origin/main` of `de-braighter/foundry`. Tasks are sequential (shared types/files) — no parallel fan-out.
