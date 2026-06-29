# Studio Node-Detail Inspector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a node is selected in the studio system-editor, show all available foundry node metadata (status, scope, yields, dependsOn, itemId, resource, …) read-only in a "Details" section of the inspector.

**Architecture:** Approach A (`meta` passthrough). The foundry catalog mapper attaches each kernel node's cleaned `metadata` as `SystemNode.meta`; the studio's `SystemNode` type gains an optional `meta`; the editor's `projectSystemToDraft` carries it onto the projected PlanNode under a namespaced `sourceMeta` key (so it never collides with the build-path operational `scope`); a pure `toDetailFields` transformer turns the bag into typed renderable descriptors; the inspector renders a read-only Details section.

**Tech Stack:** TypeScript, Node `http` (foundry dashboard), Angular standalone + signals + Vitest (studio). Spec: `docs/superpowers/specs/2026-06-29-studio-node-detail-inspector-design.md`.

## Global Constraints

- ZERO kernel change · ZERO design-system change (NO new CSS tokens — reuse existing `--ink-*`, `--rule`, `--accent`, `--accent-soft`, `--color-*`, `glass-panel`).
- Read-only throughout — no inputs/edits in the Details section; the foundry source is authoritative.
- The foundry source metadata rides ONLY the namespaced key `sourceMeta` on the projected PlanNode — never spread into raw keys (would collide with the build-path `scope`/`dependsOn`).
- Mapper drops `title` (already the node title) and `_`-prefixed internal keys (`_cascadeKey`); `meta` is `undefined` when nothing remains.
- `SystemNode.meta` is optional and absent for studio-authored systems — the feature must be inert (empty Details beyond structural facts) where there's no source metadata.
- Field order follows metadata insertion order (no imposed ordering — YAGNI).
- Two repos, two PRs: **foundry** (Task 1) merges first, then **studio** (Tasks 2–4). Studio tests use inline fixtures and do NOT require the foundry PR merged.
- Test command (foundry, from `domains/foundry`): `npx vitest run <file>` ; typecheck `npm run typecheck`.
- Test command (studio, from `domains/studio/apps/studio-ui`): `node_modules/.bin/ng test --no-watch` ; build `node_modules/.bin/ng build`.

---

## File Structure

| Repo | File | Action | Responsibility |
|---|---|---|---|
| foundry | `src/dashboard/catalog-mapper.ts` | Modify | local `SystemNode` twin gains `meta?`; `cleanMeta` helper; `buildSystemNode` attaches it |
| foundry | `src/dashboard/catalog-mapper.spec.ts` | Modify | meta attached + internal keys dropped + absent-when-empty |
| studio | `apps/studio-ui/src/app/metamodel/item-shapes.ts` | Modify | `SystemNode.meta?` |
| studio | `apps/studio-ui/src/app/system-editor/editor-model.ts` | Modify | `META.sourceMeta`; `authoringFields` carries it; `readSourceMeta` reader |
| studio | `apps/studio-ui/src/app/system-editor/editor-model.spec.ts` | Modify | projection preserves `sourceMeta` + synthetic scope still assigned; reader defensive |
| studio | `apps/studio-ui/src/app/system-editor/node-detail.ts` | **Create** | pure `toDetailFields(meta)` → `DetailField[]` + `DetailField` type |
| studio | `apps/studio-ui/src/app/system-editor/node-detail.spec.ts` | **Create** | all field renderers + generic fallback + empty |
| studio | `apps/studio-ui/src/app/system-editor/system-editor.page.ts` | Modify | `selectedDetail()` + `detailFields()` computeds + Details template section |
| studio | `apps/studio-ui/src/app/system-editor/system-editor.page.spec.ts` | Modify | Details renders known fields + sparse fallback + hides internal keys |

---

## Task 1 — Foundry: attach cleaned `meta` to each `SystemNode`

**Repo:** `domains/foundry`. Branch `feat/catalog-mapper-node-meta` from `main`.

**Files:**
- Modify: `src/dashboard/catalog-mapper.ts`
- Modify: `src/dashboard/catalog-mapper.spec.ts`

**Interfaces:**
- Produces: `SystemNode.meta?: Record<string, unknown>` on the mapper output (consumed by the studio in Tasks 2–4, via the `/api/catalog` JSON).

---

- [ ] **Step 1.1: Create the branch**

```bash
# in D:/development/projects/de-braighter/domains/foundry
git checkout main && git checkout -b feat/catalog-mapper-node-meta
```

- [ ] **Step 1.2: Write the failing test**

Append to `src/dashboard/catalog-mapper.spec.ts` (inside the top-level `describe`):

```ts
it('attaches cleaned metadata as meta on each SystemNode, dropping title and internal keys', () => {
  const nodes: PlanNode[] = [
    {
      id: 'product-1', kind: 'product', treeRootId: 'product-1', parentId: null,
      kindRef: 'product', ordinal: 0, metadata: { title: 'Root', _cascadeKey: 'p' }, childrenIds: [],
    },
    {
      id: 'wi-1', kind: 'work-item', treeRootId: 'product-1', parentId: 'product-1',
      kindRef: 'work-item', ordinal: 0,
      metadata: {
        title: 'Do it', _cascadeKey: 'w', status: 'done', resource: 'ai',
        scope: { repo: 'r', pathPrefix: 'p' }, yields: [{ kind: 'pack', id: 'x' }], dependsOn: [],
      },
      childrenIds: [],
    },
  ];

  const catalog = mapNodesToCatalog(nodes);
  const root = catalog.systems[0]!.root;

  // root carries only title + _cascadeKey → nothing left → meta undefined
  expect(root.meta).toBeUndefined();

  const wi = root.children[0]!;
  expect(wi.meta).toEqual({
    status: 'done', resource: 'ai',
    scope: { repo: 'r', pathPrefix: 'p' }, yields: [{ kind: 'pack', id: 'x' }], dependsOn: [],
  });
  expect(wi.meta!['title']).toBeUndefined();
  expect(wi.meta!['_cascadeKey']).toBeUndefined();
});
```

- [ ] **Step 1.3: Run it — verify it fails**

```bash
npx vitest run src/dashboard/catalog-mapper.spec.ts
```

Expected: FAIL — `wi.meta` is `undefined` (the mapper doesn't attach meta yet).

- [ ] **Step 1.4: Add `meta?` to the local `SystemNode` interface**

In `src/dashboard/catalog-mapper.ts`, extend the interface:

```ts
interface SystemNode {
  id: string;
  kind: SystemNodeKind;
  title: string;
  children: SystemNode[];
  meta?: Record<string, unknown>;
}
```

- [ ] **Step 1.5: Add `cleanMeta` and attach it in `buildSystemNode`**

In `src/dashboard/catalog-mapper.ts`, add the helper just above `buildSystemNode`:

```ts
/** Copy a kernel node's metadata for read-only display, dropping the title
 *  (already the node title) and internal underscore-prefixed keys (e.g. _cascadeKey).
 *  Returns undefined when nothing remains. */
function cleanMeta(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (k === 'title' || k.startsWith('_')) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

Replace the `buildSystemNode` return with:

```ts
function buildSystemNode(node: PlanNode, childrenByParent: Map<string | null, PlanNode[]>): SystemNode {
  const title = (node.metadata?.title as string) ?? node.kind;
  const kind: SystemNodeKind = node.kind === 'product' ? 'epic' : 'work';
  const kids = childrenByParent.get(node.id) ?? [];
  const meta = cleanMeta(node.metadata ?? {});
  return {
    id: node.id,
    kind,
    title,
    children: kids.map((k) => buildSystemNode(k, childrenByParent)),
    ...(meta ? { meta } : {}),
  };
}
```

- [ ] **Step 1.6: Run tests — verify all pass**

```bash
npx vitest run src/dashboard/catalog-mapper.spec.ts
```

Expected: PASS (the new test + the existing 6).

- [ ] **Step 1.7: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 1.8: Commit**

```bash
git add src/dashboard/catalog-mapper.ts src/dashboard/catalog-mapper.spec.ts
git commit -m "feat(studio-catalog-endpoints): attach cleaned node metadata as SystemNode.meta"
```

> **Controller note:** after Task 1, open the foundry PR, run the gate (reviewer + charter-checker + local-ci), merge, run the post-merge ritual. Then proceed to Task 2 in the studio repo.

---

## Task 2 — Studio: `SystemNode.meta?` + editor-model `sourceMeta` plumbing

**Repo:** `domains/studio`. Branch `feat/node-detail-inspector` from `main`.

**Files:**
- Modify: `apps/studio-ui/src/app/metamodel/item-shapes.ts`
- Modify: `apps/studio-ui/src/app/system-editor/editor-model.ts`
- Modify: `apps/studio-ui/src/app/system-editor/editor-model.spec.ts`

**Interfaces:**
- Produces: `SystemNode.meta?: Record<string, unknown>` (metamodel); `readSourceMeta(node: PlanNode): Record<string, unknown> | undefined` (editor-model, consumed by Task 4); the projected PlanNode metadata gains key `sourceMeta`.

---

- [ ] **Step 2.1: Create the branch**

```bash
# in D:/development/projects/de-braighter/domains/studio
git checkout main && git checkout -b feat/node-detail-inspector
```

- [ ] **Step 2.2: Add `meta?` to the metamodel `SystemNode`**

In `apps/studio-ui/src/app/metamodel/item-shapes.ts`, extend `SystemNode` (the interface with `id/kind/title/children/effect?/actions?/needs?/conds?`):

```ts
export interface SystemNode {
  id: string;
  kind: SystemNodeKind;
  title: string;
  children: SystemNode[];
  effect?: SystemEffect;
  /** action ids fired by this work node. */
  actions?: string[];
  /** resource ids this work node needs. */
  needs?: string[];
  /** gate-node conditions. */
  conds?: SystemGateCond[];
  /** Read-only source metadata (e.g. the foundry kernel node's metadata),
   *  surfaced in the inspector Details section. Absent for studio-authored nodes. */
  meta?: Record<string, unknown>;
}
```

- [ ] **Step 2.3: Write the failing editor-model tests**

Append to `apps/studio-ui/src/app/system-editor/editor-model.spec.ts`. First ensure these imports are present at the top (add any missing):

```ts
import { projectSystemToDraft, readSourceMeta } from './editor-model';
import type { SystemItem } from '../metamodel';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
```

Then add:

```ts
describe('sourceMeta passthrough', () => {
  function systemWithMeta(): SystemItem {
    return {
      id: 'sys-1', name: 'Sys', domain: 'foundry', desc: '', visibility: 'private',
      root: {
        id: 'root-1', kind: 'epic', title: 'Root', children: [
          {
            id: 'wi-1', kind: 'work', title: 'Do it', children: [],
            meta: { status: 'done', scope: { repo: 'r', pathPrefix: 'p' } },
          },
        ],
      },
    };
  }

  it('projectSystemToDraft carries SystemNode.meta onto the PlanNode under sourceMeta', () => {
    const draft = projectSystemToDraft(systemWithMeta());
    const wi = draft.nodes.find((n) => n.id === 'wi-1')!;
    expect(wi.metadata['sourceMeta']).toEqual({ status: 'done', scope: { repo: 'r', pathPrefix: 'p' } });
    // the synthetic build-path scope is still assigned independently (no collision)
    expect(wi.metadata['scope']).toEqual({ repo: 'de-braighter/studio', pathPrefix: 'work/wi-1/' });
  });

  it('readSourceMeta returns the object, or undefined for absent/malformed', () => {
    const make = (sourceMeta: unknown): PlanNode => ({
      id: 'n', kind: 'work-item', treeRootId: 't', parentId: 't', kindRef: 'work-item',
      ordinal: 0, metadata: sourceMeta === undefined ? {} : { sourceMeta }, childrenIds: [],
    });
    expect(readSourceMeta(make({ a: 1 }))).toEqual({ a: 1 });
    expect(readSourceMeta(make(undefined))).toBeUndefined();
    expect(readSourceMeta(make('nope'))).toBeUndefined();
    expect(readSourceMeta(make([1, 2]))).toBeUndefined();
  });
});
```

- [ ] **Step 2.4: Run them — verify they fail**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: FAIL — `sourceMeta` not carried; `readSourceMeta` not exported.

- [ ] **Step 2.5: Add the `sourceMeta` key + carry it in `authoringFields`**

In `apps/studio-ui/src/app/system-editor/editor-model.ts`, add `sourceMeta` to the `META` const:

```ts
const META = {
  label: 'label',
  effect: 'effect',
  actions: 'actions',
  needs: 'needs',
  conds: 'conds',
  systemName: 'systemName',
  domain: 'domain',
  sourceMeta: 'sourceMeta',
} as const;
```

In `authoringFields`, after the `conds` line and before the `scope` line, add:

```ts
  if (systemNode.meta && Object.keys(systemNode.meta).length > 0) {
    fields[META.sourceMeta] = { ...systemNode.meta };
  }
```

- [ ] **Step 2.6: Add the `readSourceMeta` reader**

In `apps/studio-ui/src/app/system-editor/editor-model.ts`, add near the other metadata accessors (e.g. after `readGateConds`):

```ts
/** Read a node's read-only source metadata (e.g. foundry kernel-node metadata),
 *  or undefined when absent/malformed. Never throws. */
export function readSourceMeta(node: PlanNode): Record<string, unknown> | undefined {
  const v = node.metadata[META.sourceMeta];
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
```

- [ ] **Step 2.7: Run tests — verify pass + typecheck via build**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: PASS (the two new tests + existing editor-model suite green).

- [ ] **Step 2.8: Commit**

```bash
git add apps/studio-ui/src/app/metamodel/item-shapes.ts apps/studio-ui/src/app/system-editor/editor-model.ts apps/studio-ui/src/app/system-editor/editor-model.spec.ts
git commit -m "feat(node-detail): SystemNode.meta + editor-model sourceMeta passthrough"
```

---

## Task 3 — Studio: pure `toDetailFields` transformer

**Repo:** `domains/studio` (same branch `feat/node-detail-inspector`).

**Files:**
- Create: `apps/studio-ui/src/app/system-editor/node-detail.ts`
- Create: `apps/studio-ui/src/app/system-editor/node-detail.spec.ts`

**Interfaces:**
- Produces: `DetailField` (discriminated union) and `toDetailFields(meta: Record<string, unknown> | undefined): DetailField[]` — consumed by Task 4.

---

- [ ] **Step 3.1: Write the failing tests**

Create `apps/studio-ui/src/app/system-editor/node-detail.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toDetailFields } from './node-detail';

describe('toDetailFields', () => {
  it('returns [] for undefined meta', () => {
    expect(toDetailFields(undefined)).toEqual([]);
  });

  it('renders status as a status field with done flag', () => {
    expect(toDetailFields({ status: 'done' })).toEqual([
      { label: 'Status', kind: 'status', value: 'done', done: true },
    ]);
    expect(toDetailFields({ status: 'queued' })[0]).toMatchObject({ kind: 'status', done: false });
  });

  it('renders scope as repo + path', () => {
    expect(toDetailFields({ scope: { repo: 'r', pathPrefix: 'p/q' } })).toEqual([
      { label: 'Scope', kind: 'scope', repo: 'r', path: 'p/q' },
    ]);
  });

  it('renders yields as kind:id items', () => {
    expect(toDetailFields({ yields: [{ kind: 'pack', id: 'x' }, { kind: 'policy', id: 'y' }] })).toEqual([
      { label: 'Yields', kind: 'yields', items: [{ yieldKind: 'pack', id: 'x' }, { yieldKind: 'policy', id: 'y' }] },
    ]);
  });

  it('renders dependsOn as a list (empty allowed)', () => {
    expect(toDetailFields({ dependsOn: [] })).toEqual([{ label: 'DependsOn', kind: 'list', values: [] }]);
    expect(toDetailFields({ dependsOn: ['a', 'b'] })[0]).toMatchObject({ kind: 'list', values: ['a', 'b'] });
  });

  it('renders scalars as text (string/number/boolean)', () => {
    expect(toDetailFields({ itemId: 'foundry/1' })).toEqual([{ label: 'Item', kind: 'text', value: 'foundry/1' }]);
    expect(toDetailFields({ riskTier: 'T0' })).toEqual([{ label: 'Risk-Tier', kind: 'text', value: 'T0' }]);
  });

  it('falls back to compact JSON for unrecognised objects/arrays', () => {
    expect(toDetailFields({ weird: { a: [1, 2] } })).toEqual([
      { label: 'weird', kind: 'json', value: '{"a":[1,2]}' },
    ]);
  });

  it('preserves insertion order and uses the raw key as label when unknown', () => {
    const fields = toDetailFields({ status: 'done', customKey: 'v' });
    expect(fields.map((f) => f.label)).toEqual(['Status', 'customKey']);
  });
});
```

- [ ] **Step 3.2: Run them — verify they fail**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: FAIL — `Cannot find module './node-detail'`.

- [ ] **Step 3.3: Implement `node-detail.ts`**

Create `apps/studio-ui/src/app/system-editor/node-detail.ts`:

```ts
// node-detail.ts — pure transformer: a node's read-only source-metadata bag → a
// list of typed, renderable field descriptors for the inspector Details section.
// No Angular, no I/O; fully unit-testable. Known foundry fields get a dedicated
// shape; everything else falls back to text (scalars) or compact JSON (objects).

export type DetailField =
  | { label: string; kind: 'status'; value: string; done: boolean }
  | { label: string; kind: 'scope'; repo: string; path: string }
  | { label: string; kind: 'yields'; items: { yieldKind: string; id: string }[] }
  | { label: string; kind: 'list'; values: string[] }
  | { label: string; kind: 'text'; value: string }
  | { label: string; kind: 'json'; value: string };

/** Human labels for the known foundry metadata keys. Unknown keys render verbatim. */
const KNOWN_LABELS: Readonly<Record<string, string>> = {
  status: 'Status',
  scope: 'Scope',
  itemId: 'Item',
  resource: 'Resource',
  yields: 'Yields',
  dependsOn: 'DependsOn',
  riskTier: 'Risk-Tier',
  repo: 'Repo',
  productKey: 'Product',
};

function isScope(v: unknown): v is { repo: string; pathPrefix: string } {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as Record<string, unknown>)['repo'] === 'string' &&
    typeof (v as Record<string, unknown>)['pathPrefix'] === 'string'
  );
}

function isYields(v: unknown): v is { kind: unknown; id: unknown }[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && 'kind' in x && 'id' in x);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Transform a node's source-metadata bag into renderable field descriptors.
 *  Insertion order is preserved; undefined → []. */
export function toDetailFields(meta: Record<string, unknown> | undefined): DetailField[] {
  if (!meta) return [];
  const fields: DetailField[] = [];
  for (const [key, value] of Object.entries(meta)) {
    const label = KNOWN_LABELS[key] ?? key;
    if (key === 'status' && typeof value === 'string') {
      fields.push({ label, kind: 'status', value, done: value === 'done' });
    } else if (key === 'scope' && isScope(value)) {
      fields.push({ label, kind: 'scope', repo: value.repo, path: value.pathPrefix });
    } else if (key === 'yields' && isYields(value)) {
      fields.push({ label, kind: 'yields', items: value.map((y) => ({ yieldKind: String(y.kind), id: String(y.id) })) });
    } else if (key === 'dependsOn' && isStringArray(value)) {
      fields.push({ label, kind: 'list', values: [...value] });
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields.push({ label, kind: 'text', value: String(value) });
    } else {
      fields.push({ label, kind: 'json', value: JSON.stringify(value) });
    }
  }
  return fields;
}
```

- [ ] **Step 3.4: Run tests — verify pass**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: PASS (8 node-detail tests + the rest of the suite).

- [ ] **Step 3.5: Commit**

```bash
git add apps/studio-ui/src/app/system-editor/node-detail.ts apps/studio-ui/src/app/system-editor/node-detail.spec.ts
git commit -m "feat(node-detail): pure toDetailFields transformer"
```

---

## Task 4 — Studio: inspector `selectedDetail()` + Details section

**Repo:** `domains/studio` (same branch `feat/node-detail-inspector`).

**Files:**
- Modify: `apps/studio-ui/src/app/system-editor/system-editor.page.ts`
- Modify: `apps/studio-ui/src/app/system-editor/system-editor.page.spec.ts`

**Interfaces:**
- Consumes: `readSourceMeta` (Task 2), `toDetailFields` + `DetailField` (Task 3), the existing `selectedNode`/`rows`/`inspKind` computeds and `draft` signal.
- Produces: a `[data-testid="node-details"]` Details section in the inspector.

---

- [ ] **Step 4.1: Write the failing component test**

In `apps/studio-ui/src/app/system-editor/system-editor.page.spec.ts`, mirror the existing harness that feeds a `SystemItem` and selects a node (find the existing test that calls `select(...)` / sets the system input — reuse its `TestBed` setup, fixture creation, and the helper that opens a system). Add:

```ts
it('renders a read-only Details section with the selected node source metadata', async () => {
  // Build a SystemItem whose work node carries source metadata, feed it the same way
  // the existing tests do (component input + ngOnInit projection), then select 'wi-1'.
  const system = {
    id: 'sys-1', name: 'Sys', domain: 'foundry', desc: '', visibility: 'private' as const,
    root: {
      id: 'root-1', kind: 'epic' as const, title: 'Root', children: [
        {
          id: 'wi-1', kind: 'work' as const, title: 'Do it', children: [],
          meta: { status: 'done', scope: { repo: 'de-braighter/foundry', pathPrefix: 'src/x.ts' }, itemId: 'foundry/1' },
        },
      ],
    },
  };
  // ── setup: feed `system` + detectChanges exactly as the existing system-editor tests do ──
  // (component.system input or the harness helper), then:
  component.select('wi-1');
  fixture.detectChanges();

  const details = fixture.nativeElement.querySelector('[data-testid="node-details"]') as HTMLElement;
  expect(details).toBeTruthy();
  const text = details.textContent ?? '';
  expect(text).toContain('Status');
  expect(text).toContain('done');
  expect(text).toContain('de-braighter/foundry');
  expect(text).toContain('src/x.ts');
  expect(text).toContain('foundry/1');
  // internal keys never surface
  expect(text).not.toContain('_cascadeKey');
  // structural facts present
  expect(text).toContain('Parent');
  expect(text).toContain('Root');
});

it('shows only structural facts for a node with no source metadata', async () => {
  const system = {
    id: 'sys-2', name: 'Sys', domain: 'foundry', desc: '', visibility: 'private' as const,
    root: { id: 'root-1', kind: 'epic' as const, title: 'Root', children: [
      { id: 'cap-1', kind: 'work' as const, title: 'A capability', children: [] },
    ] },
  };
  // ── setup as above ──, then:
  component.select('cap-1');
  fixture.detectChanges();
  const details = fixture.nativeElement.querySelector('[data-testid="node-details"]') as HTMLElement;
  expect(details).toBeTruthy();
  expect(details.textContent ?? '').toContain('Parent');
});
```

> The exact `TestBed`/fixture/system-feeding lines must match the existing `system-editor.page.spec.ts` setup — copy that harness; only the assertions above are new.

- [ ] **Step 4.2: Run it — verify it fails**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: FAIL — no `[data-testid="node-details"]` element.

- [ ] **Step 4.3: Add the imports**

In `apps/studio-ui/src/app/system-editor/system-editor.page.ts`, add `readSourceMeta` to the existing import from `./editor-model`, and import the transformer:

```ts
import { /* …existing…, */ readSourceMeta } from './editor-model';
import { toDetailFields, type DetailField } from './node-detail';
```

- [ ] **Step 4.4: Add the `selectedDetail` + `detailFields` computeds**

In the component class (near the existing `effect` computed), add:

```ts
  // read-only Details view-model for the selected node (source metadata + structural facts)
  readonly selectedDetail = computed<{ parentTitle?: string; childCount: number; meta?: Record<string, unknown> } | undefined>(() => {
    const n = this.selectedNode();
    if (!n) return undefined;
    const parentRow = n.parentId ? this.rows().find((r) => r.id === n.parentId) : undefined;
    return { parentTitle: parentRow?.title, childCount: n.childrenIds.length, meta: readSourceMeta(n) };
  });
  readonly detailFields = computed<DetailField[]>(() => toDetailFields(this.selectedDetail()?.meta));
```

- [ ] **Step 4.5: Add the Details template section**

In the inspector `<aside>` template, immediately AFTER the title-header `<div>` (the one closing at the end of the `inspKind() · sel.id` + title-input block, around line 360) and BEFORE the `<!-- WORK NODE → PREDICTED EFFECT… -->` comment, insert:

```html
              <!-- DETAILS — read-only source metadata + structural facts -->
              @if (selectedDetail(); as det) {
                <div data-testid="node-details" class="glass-panel" role="group" aria-label="Details"
                     style="border:1px solid var(--rule);border-radius:13px;padding:.85rem 1rem 1rem;margin-bottom:1rem;">
                  <div style="font-family:var(--font-mono);font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:.6rem;">Details</div>
                  <dl style="margin:0;display:grid;grid-template-columns:auto 1fr;gap:.3rem .8rem;font-size:.8rem;">
                    <dt style="color:var(--ink-3);">Kind</dt><dd style="margin:0;color:var(--ink);">{{ inspKind() }}</dd>
                    @if (det.parentTitle) {
                      <dt style="color:var(--ink-3);">Parent</dt><dd style="margin:0;color:var(--ink);">{{ det.parentTitle }}</dd>
                    }
                    <dt style="color:var(--ink-3);">Children</dt><dd style="margin:0;color:var(--ink);">{{ det.childCount }}</dd>
                    @for (f of detailFields(); track $index) {
                      <dt style="color:var(--ink-3);">{{ f.label }}</dt>
                      <dd style="margin:0;color:var(--ink);min-width:0;word-break:break-word;">
                        @switch (f.kind) {
                          @case ('status') {
                            <span aria-hidden="true" [style.color]="f.done ? 'var(--accent)' : 'var(--ink-3)'">&#9679;</span> {{ f.value }}
                          }
                          @case ('scope') {
                            <span>{{ f.repo }}</span><br /><span style="font-family:var(--font-mono);font-size:.74rem;color:var(--ink-2);">{{ f.path }}</span>
                          }
                          @case ('yields') {
                            @for (y of f.items; track y.id) { <div>{{ y.yieldKind }}: {{ y.id }}</div> }
                          }
                          @case ('list') { {{ f.values.length ? f.values.join(', ') : '—' }} }
                          @case ('json') { <code style="font-family:var(--font-mono);font-size:.74rem;">{{ f.value }}</code> }
                          @default { {{ f.value }} }
                        }
                      </dd>
                    }
                  </dl>
                </div>
              }
```

> Reuse only existing tokens (`--ink`, `--ink-2`, `--ink-3`, `--rule`, `--accent`, `--font-mono`, `glass-panel`). The status dot is `aria-hidden` (decorative); the value text carries the meaning. No new tokens.

- [ ] **Step 4.6: Run tests — verify pass**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: PASS (the two new component tests + the full suite green).

- [ ] **Step 4.7: Production build**

```bash
node_modules/.bin/ng build
```

Expected: clean compile (catches standalone/template wiring errors vitest's esbuild can miss).

- [ ] **Step 4.8: Commit**

```bash
git add apps/studio-ui/src/app/system-editor/system-editor.page.ts apps/studio-ui/src/app/system-editor/system-editor.page.spec.ts
git commit -m "feat(node-detail): inspector Details section (read-only source metadata)"
```

> **Controller note:** after Task 4, open the studio PR, run the gate (reviewer + charter-checker + qa-engineer + local-ci), merge, run the ritual, then browser re-verify: restart the foundry server with merged code, reload the studio, open the Foundry system, select a work-item, confirm the Details section renders its metadata.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| D1 — all available metadata, read-only | Tasks 1 (carry) + 3 (render all) + 4 (read-only section) |
| D2 — meta passthrough (Approach A) | Tasks 1–4 |
| D3 — namespaced `sourceMeta`, no scope collision | Task 2 (+ test asserts synthetic scope still assigned) |
| D4 — generic, inert where absent | Task 2 (`meta?` optional) + Task 4 (sparse-node test) |
| D5 — drop `title` + `_`-prefixed keys | Task 1 (`cleanMeta` + test) |
| Known-field renderers + generic fallback | Task 3 (`toDetailFields` + tests) |
| Always-available structural facts | Task 4 (`selectedDetail` Kind/Parent/Children) |
| A11y description-list + decorative dot | Task 4 (`dl/dt/dd`, `aria-hidden` dot) |
| No new design tokens | Global constraint + Task 4 (existing tokens only) |
| `status` is seed not live (caveat) | Out of scope — rendered as-stored (Task 3 text/status) |

All covered. ✓

**Placeholder scan:** No TBD/TODO. The only "match the existing harness" note is Task 4's `TestBed` setup, which deliberately defers to the in-repo spec pattern (the assertions are complete). ✓

**Type consistency:** `SystemNode.meta` (Tasks 1 local twin, 2 metamodel) · `sourceMeta` key (Task 2 `META.sourceMeta`, Task 4 via `readSourceMeta`) · `DetailField`/`toDetailFields` (Task 3 → Task 4) · `readSourceMeta` (Task 2 → Task 4) — all consistent. ✓
