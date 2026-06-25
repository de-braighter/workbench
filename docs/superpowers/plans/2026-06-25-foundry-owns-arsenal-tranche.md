# Foundry Owns the Arsenal — Catalog + Linkage (D5.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. **This plan is the input to the foundry `/build-path`** — each Task maps 1:1 to a foundry work item (A1/A2).

**Goal:** Catalog the ~71 `.claude/` skills+agents as a derived actuator registry, link governance nodes to the actuators they invoke (validated against the catalog), and surface it in the cockpit — without modifying any skill/agent file.

**Architecture:** A pure `deriveArsenalCatalog` fold over frontmatter parsed by a thin `scanArsenal` I/O edge (store-generators-derive-graphs); governance nodes gain optional `metadata.actuators[]` validated by `validateActuatorRefs` (dangling + orphan); a Studio cockpit surface displays catalog + linkage + drift. Zero kernel change; no file generation; no founder gate.

**Tech Stack:** TypeScript (ESM, `.js` extensions), vitest, Angular 21 signals (Studio).

## Global Constraints

- **Read the MERGED governance engine first** (`domains/foundry/src/governance/node.ts` — `governanceFields`, `REVIEW_FLOOR_NODE`; `src/governance/policies.ts`, `src/governance/workflows.ts` — node specs + `metadata`; and for A2 the `/governance` cockpit `apps/studio-ui/src/app/governance/*`). Match real exports; plan signatures are illustrative.
- **`actuators[]` is METADATA only** — adding it to a node changes NO generated fragment (the fragment is `authoredContent.body`). The D5/D5.2/D5.3 fixtures + owned policy/workflow files MUST stay byte-identical (regression-verify).
- **No file generation, no founder gate** — the `.claude/skills` + `.claude/agents` files are read-only sources; never written.
- **Derived, never stored** (ADR-242) — catalog + validation are pure functions; the scan is the I/O edge, the fold is pure + fixture-tested.
- **Zero kernel change** (ADR-176 pack-level). ADR-243 agnosticism: no `productKey` literal in `src/compiler/*`; arsenal code lives in `src/arsenal/` (no agnosticism gate there, but keep it domain-neutral).
- **Per-repo CI:** foundry → `NX_DAEMON=false npm run ci:local`; studio → `pnpm -r run build` + governance vitest + `ng serve` browser-verify.
- **Product home:** `system-builder-studio`, keys `A1`/`A2`.

---

## File Structure

**`domains/foundry`:**
- Create `src/arsenal/actuator.ts` — `ArsenalActuator` type + `deriveArsenalCatalog` pure fold.
- Create `src/arsenal/scan.ts` — `scanArsenal(claudeDir)` I/O edge (read dirs + parse frontmatter).
- Create `src/arsenal/link.ts` — `validateActuatorRefs(tree, catalog)`.
- Create `src/arsenal/actuator.spec.ts`, `src/arsenal/link.spec.ts`, `src/arsenal/scan.spec.ts` (+ fixtures under `src/arsenal/__fixtures__/`).
- Modify `src/governance/node.ts` (+ `policies.ts`/`workflows.ts` if seeding there) — add `actuators[]` to the relevant nodes' `metadata`.

**`domains/studio/apps/studio-ui`:**
- Modify `src/app/governance/governance-read.port.ts` + `governance-view-model.ts` + `governance.page.ts` — an arsenal section (catalog + linkage + drift). Test: `governance.page.spec.ts`.

---

## Task A1: Arsenal catalog + linkage (foundry)

**Files:** Create `src/arsenal/{actuator,scan,link}.ts` + specs + `__fixtures__/`; Modify `src/governance/node.ts` (+ `policies.ts`/`workflows.ts`) to seed `actuators[]`.

**Scope:** `domains/foundry`, pathPrefix `src/arsenal` (+ `src/governance` for the seed). **DependsOn:** none. **Quality:** wave-standard.

**Interfaces:**
- Produces:
  - `interface ArsenalActuator { id: string; kind: 'skill' | 'agent'; description: string; model?: string; tools?: string[] }`
  - `deriveArsenalCatalog(sources: ArsenalActuator[]): ReadonlyMap<string, ArsenalActuator>` (dedup by id, stable insertion order).
  - `scanArsenal(claudeDir: string): ArsenalActuator[]` (reads `<claudeDir>/skills/*/SKILL.md` + `<claudeDir>/agents/*.md`, parses YAML frontmatter `name`/`description`/`model`/`tools`).
  - `actuatorsOf(node: PlanNode): string[]` (reads `metadata.actuators`, default `[]`).
  - `validateActuatorRefs(nodes: PlanNode[], catalog: ReadonlyMap<string, ArsenalActuator>): { dangling: { nodeKey: string; actuatorId: string }[]; orphans: string[] }`.

- [ ] **Step 1: Read merged code** — `src/governance/node.ts` (`governanceFields`, the `metadata` cast convention, `REVIEW_FLOOR_NODE`), `policies.ts`/`workflows.ts` (node `meta` shape + `_cascadeKey`), `src/plan/cascade.ts` (`PlanNode`, `buildCascadeTree`). Check whether a YAML/frontmatter parser is already a dep (e.g. `yaml`); if not, parse the simple frontmatter block manually (split on `---`).

- [ ] **Step 2: Write the failing catalog test** — `src/arsenal/actuator.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveArsenalCatalog, type ArsenalActuator } from './actuator.js';

describe('deriveArsenalCatalog (A1)', () => {
  const sources: ArsenalActuator[] = [
    { id: 'reviewer', kind: 'agent', description: 'adversarial review', model: 'opus', tools: ['Read', 'Bash'] },
    { id: 'code-review', kind: 'skill', description: 'review the current diff' },
    { id: 'reviewer', kind: 'agent', description: 'dup — later wins or dedups' },
  ];
  it('folds sources into an id-keyed catalog, dedup by id', () => {
    const cat = deriveArsenalCatalog(sources);
    expect(cat.size).toBe(2);
    expect(cat.get('reviewer')?.kind).toBe('agent');
    expect(cat.get('code-review')?.kind).toBe('skill');
  });
  it('a new actuator id appears with zero code change (genericity)', () => {
    const cat = deriveArsenalCatalog([...sources, { id: 'qa-engineer', kind: 'agent', description: 'qa' }]);
    expect(cat.has('qa-engineer')).toBe(true);
  });
});
```

- [ ] **Step 3: Run red** — `cd domains/foundry && NX_DAEMON=false npx vitest run src/arsenal/actuator.spec.ts`.

- [ ] **Step 4: Implement** `src/arsenal/actuator.ts`:

```typescript
export interface ArsenalActuator {
  id: string;
  kind: 'skill' | 'agent';
  description: string;
  model?: string;
  tools?: string[];
}

export function deriveArsenalCatalog(sources: ArsenalActuator[]): ReadonlyMap<string, ArsenalActuator> {
  const out = new Map<string, ArsenalActuator>();
  for (const a of sources) out.set(a.id, a); // dedup by id (last wins), stable insertion order
  return out;
}
```

Run green.

- [ ] **Step 5: Linkage test + impl** — `src/arsenal/link.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildCascadeTree } from '../plan/cascade.js';
import { deriveArsenalCatalog } from './actuator.js';
import { validateActuatorRefs } from './link.js';

describe('validateActuatorRefs (A1)', () => {
  const catalog = deriveArsenalCatalog([
    { id: 'reviewer', kind: 'agent', description: 'r' },
    { id: 'code-review', kind: 'skill', description: 'c' },
  ]);
  it('flags a dangling ref (node -> missing actuator) and orphans (cataloged, unreferenced)', () => {
    const tree = buildCascadeTree([
      { key: 'g1', kind: 'guardrail', parent: null, meta: { actuators: ['reviewer', 'ghost-agent'] } },
    ]);
    const r = validateActuatorRefs(tree, catalog);
    expect(r.dangling).toContainEqual({ nodeKey: 'g1', actuatorId: 'ghost-agent' });
    expect(r.orphans).toContain('code-review'); // cataloged but referenced by no node
    expect(r.orphans).not.toContain('reviewer');
  });
});
```

Implement `src/arsenal/link.ts`:

```typescript
import type { PlanNode } from '../plan/cascade.js';
import type { ArsenalActuator } from './actuator.js';

export function actuatorsOf(node: PlanNode): string[] {
  const a = (node.metadata as Record<string, unknown>)['actuators'];
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
}

export function validateActuatorRefs(
  nodes: PlanNode[],
  catalog: ReadonlyMap<string, ArsenalActuator>,
): { dangling: { nodeKey: string; actuatorId: string }[]; orphans: string[] } {
  const referenced = new Set<string>();
  const dangling: { nodeKey: string; actuatorId: string }[] = [];
  for (const n of nodes) {
    const key = String((n.metadata as Record<string, unknown>)['_cascadeKey'] ?? n.id);
    for (const id of actuatorsOf(n)) {
      referenced.add(id);
      if (!catalog.has(id)) dangling.push({ nodeKey: key, actuatorId: id });
    }
  }
  const orphans = [...catalog.keys()].filter((id) => !referenced.has(id));
  return { dangling, orphans };
}
```

Run green. **Mutation check:** dropping the `!catalog.has(id)` push makes the dangling test RED.

- [ ] **Step 6: The scanner + real-`.claude/` snapshot** — `src/arsenal/scan.ts` reads `<claudeDir>/skills/*/SKILL.md` + `<claudeDir>/agents/*.md`, parses the YAML frontmatter block (`name`→`id`, `description`, `model`, `tools`), returns `ArsenalActuator[]` (kind by source dir). Add `src/arsenal/scan.spec.ts`: (a) a fixture dir under `src/arsenal/__fixtures__/claude/` with 1 skill + 1 agent → asserts both parsed with correct kind/fields; (b) a snapshot over the real cluster `.claude/` resolved relative to the repo (e.g. `path.resolve(__dirname, '../../../../.claude')` — VERIFY the depth from `src/arsenal/` to the cluster root; the foundry is `domains/foundry`, so the cluster `.claude` is `../../.claude` from the repo root) asserting `>= 60` actuators and that `reviewer`, `charter-checker`, `code-review`, `build-path` are present. If the relative path is fragile in the test env, gate the real-snapshot test behind an existence check (`fs.existsSync`) and `it.skip` with a clear note rather than failing.

- [ ] **Step 7: Seed `actuators[]` on the existing governance nodes** — in `src/governance/node.ts` add `actuators: ['code-review', 'reviewer', 'charter-checker', 'qa-engineer', 'local-ci']` to `REVIEW_FLOOR_NODE.meta`; in `workflows.ts` add to the `verifier-wave` node `actuators: ['local-ci', 'reviewer', 'charter-checker', 'qa-engineer', 'exercir-charter-checker']`, to `designer-first` `actuators: ['designer', 'substrate-architect', 'product-strategist', 'implementer']`, to `story-tracker` `actuators: ['triage']` (or `[]` if none clearly apply — an empty list is valid). **These are `meta.actuators` — NOT in `authoredContent`** — so the generated fragments + the owned files stay byte-identical (verify the D5.2/D5.3 fixtures unchanged).

- [ ] **Step 8: Genericity + regression** — extend `wedge.integration.spec.ts` (or a new `arsenal.integration.spec.ts`): run `validateActuatorRefs(buildCascadeTree([REVIEW_FLOOR_NODE, ...POLICY_NODES, ...WORKFLOW_NODES]), deriveArsenalCatalog(scanArsenal(realClaudeDir)))` → assert ZERO dangling (every seeded actuator resolves to a real `.claude/` actuator — this is the live drift check). Assert the policy/workflow fixtures are byte-unchanged.

- [ ] **Step 9: Gate + commit** — `NX_DAEMON=false npm run ci:local` green (D5/D5.2/D5.3 tests + fixtures byte-stable).

```bash
git add domains/foundry/src/arsenal domains/foundry/src/governance
git commit -m "feat(foundry): arsenal catalog + governance actuator linkage (A1)"
```

- [ ] **Step 10: Verifier wave** — `reviewer` + `qa-engineer` + `charter-checker` FOREGROUND (model opus), one message, **read return-values, no SendMessage wait**. charter confirms zero-kernel-change + derived-not-stored. Fix BLOCKING, re-verify. Open PR (base main; `Producer:`/`Effort: standard`); `foundry_release { claimId, outcome: 'built', prRef }`.

---

## Task A2: Cockpit Arsenal surface (studio)

**Files:** Modify `apps/studio-ui/src/app/governance/governance-read.port.ts` + `governance-view-model.ts` + `governance.page.ts`; Test: `governance.page.spec.ts`.

**Scope:** `domains/studio`, pathPrefix `apps/studio-ui/src/app/governance`. **DependsOn:** A1. **Quality:** wave-standard + a11y-battery + browser-verify.

**Interfaces:** Consumes the merged G3/W3 `GovernanceSnapshot`. Produces a `GovernanceSnapshot.arsenal?: { actuators: { id, kind, description }[]; linkages: { nodeKey, actuatorId }[]; drift: { dangling: {nodeKey, actuatorId}[]; orphans: string[] } }` + view-model rows + a page section.

- [ ] **Step 1: Read the merged `/governance` surface** (the `GovernanceSnapshot`, `buildGovernanceViewModel`, the page). The arsenal is an additive section.

- [ ] **Step 2: Failing view-model test** — extend `governance.page.spec.ts`:

```typescript
it('exposes the arsenal catalog + drift in the view-model', () => {
  const vm = buildGovernanceViewModel(/* snapshot with arsenal */ snapshotWithArsenal());
  expect(vm.arsenal.actuatorCount).toBeGreaterThanOrEqual(2);
  expect(vm.arsenal.danglingCount).toBe(0);     // healthy linkage
  expect(vm.arsenal.orphanCount).toBeGreaterThanOrEqual(0);
});
```

> Adapt to the real `GovernanceViewModel` shape — add an `arsenal` block. Match merged field names.

- [ ] **Step 3: Run red**, then extend the port (default in-memory snapshot carries a representative `arsenal` block — a handful of actuators + the seeded linkages + a zero-dangling drift), the view-model (`arsenal` counts + rows), and the page (an "Arsenal" section: actuator rows with skill/agent kind chips + description; a "linked by" column or sub-list; a drift banner that is green when `dangling.length === 0` and warns otherwise). Run green.

- [ ] **Step 4: Gate + browser-verify** — `cd apps/studio-ui && NX_DAEMON=false npm run build` + governance vitest; `ng serve`, navigate `/governance`, screenshot — confirm the Arsenal section renders (rows + kind chips + drift banner) under the canonical `[data-theme]`/`data-skin` tokens (not blank). Wave (reviewer + qa + charter + a11y-pro, FOREGROUND, read return-values). Fix BLOCKING, re-verify (re-screenshot).

- [ ] **Step 5: Commit + PR + release**

```bash
git add domains/studio/apps/studio-ui/src/app/governance
git commit -m "feat(studio): cockpit Arsenal surface — catalog + linkage + drift (A2)"
```
Open PR (base main; `Producer:`/`Effort: standard`; note the screenshot); `foundry_release { claimId, outcome: 'built', prRef }`.

---

## Self-Review

**Spec coverage:** §2 catalog (`ArsenalActuator`/`deriveArsenalCatalog`/`scanArsenal`) → A1 Steps 2/4/6; linkage (`actuators[]`/`validateActuatorRefs`/seed) → A1 Steps 5/7; §3 A1/A2 → Tasks A1/A2; §5 acids (catalog genericity, linkage drift, real-snapshot, non-regression) → A1 Steps 2/5/6/8. All mapped. No founder-gate (consistent — no file generation).

**Placeholder scan:** the real-`.claude/` path depth (A1 Step 6) is flagged as "VERIFY" with a fallback `it.skip` — an explicit instruction, not a TODO. No other placeholders.

**Type consistency:** `ArsenalActuator` (A1) consumed by `deriveArsenalCatalog`/`scanArsenal`/`validateActuatorRefs`; `actuatorsOf`/`validateActuatorRefs` return shapes consistent A1→A2; `GovernanceSnapshot.arsenal` (A2) matches the `validateActuatorRefs` output shape (`dangling`/`orphans`).

## Dependency / scope summary (for `/build-path`)

| Item | Scope (repo · pathPrefix) | DependsOn | Gate |
|---|---|---|---|
| A1 | foundry · `src/arsenal` + `src/governance` | — | — |
| A2 | studio · `apps/studio-ui/src/app/governance` | A1 | — |

After A1 lands, A2 proceeds. No founder-gated item in this tranche.
