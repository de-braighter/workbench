# Knowledge Layer — S1 (Document Management: Retrieval + References) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a knowledge corpus real on the substrate: a plan tree of **knowledge nodes** (`kind = "knowledge.*"`, no `effectDeclarations`, a typed contract on `metadata.knowledge`, content behind a `ContentPort`), with `metadata.knowledge.cites[]` citation capture, a **layer-side derived backlink index** (`whoCites`) + impact set (never stored), and a **layer-owned pgvector retrieval index** — then prove it end-to-end with the **foundry architecture-knowledge pack-skin** as the first consumer. *"Find the exact doc/context; tell me where it's cited."* Zero kernel change.

**Architecture:** Builds on S0's `layers/knowledge` workspace. `knowledge-contracts` gains the pure lens (`readKnowledge`/`writeKnowledge` over `PlanNode.metadata.knowledge`, mirroring charter-runtime's `readCharter`/`writeCharter`), the citation vocabulary, the `ContentPort`/`RetrievalPort` port interfaces, and the pack-skin descriptor type. `knowledge-runtime` gains the NestJS `KnowledgeModule.forRoot`, the `ContentPort` adapters (git/object-store/fhir), the **layer-owned** `knowledge.retrieval_index` pgvector table (own SQL + RLS on the `app.tenant_pack_id` GUC, reusing `ScopedPrismaService`), the pgvector `RetrievalPort` adapter, and the **derived** backlink/impact index (rebuildable views, never authoritative — D3). Persistence of the tree is the published `PLAN_TREE_STORE` (`PrismaPlanTreeStore` over `kernel.plan_node`); citations are written with the published `metadata-patch` edit verb so structure is never mutated.

**Tech Stack:** TypeScript (ESM/NodeNext), Zod, Vitest; `@de-braighter/substrate-contracts` (`/plan-tree`) type-only in contracts; `@de-braighter/substrate-runtime` (`PrismaPlanTreeStore`, `ScopedPrismaService`, `SubstrateModule.forRoot`) in runtime; NestJS 10; Prisma + Postgres 16 with the `vector` extension (pgvector); the substrate DB-test harness.

**Spec:** `docs/superpowers/specs/2026-06-28-knowledge-pack-design.md` — §1 (one tree, knowledge nodes), §3 (architecture + the metadata shape), §4 (the reference graph: stored generator `cites[]` + derived `whoCites`/`impactOf`), §5 (pack-skin), §6 S1, §7 (foundry architecture-knowledge skin), D3/D4/D5/D6/D7, OQ1 (sub-document granularity), OQ3 (embedding choice). Precedent: `layers/charter-runtime/src/charter-node.ts`.

**Cross-repo note:** Tasks 1–7 are in `layers/knowledge/` (own branch). Task 7 (foundry architecture-knowledge pack-skin) is the validating consumer; whether it lives in `layers/knowledge` (as a shipped reference skin) or in `domains/foundry` is decided in Task 7 Step 1 — default: a reference skin in the layer's `libs/knowledge-skins/` so it ships as a published example, with foundry wiring it later (avoids re-coupling foundry to the layer before its substrate bump — see S0 risk).

---

## Global Constraints

- **ESM/NodeNext** — explicit `.js` on every relative import; `"type": "module"`.
- **ZERO kernel change (STOP/escalate)** — no `layers/substrate` production file is edited (the same byte-identical list as S0: `libs/substrate-contracts/src/plan-tree/*`, `libs/substrate-runtime/src/plan-tree/*`, `kernel.*` schema/migrations). The knowledge node is a **typed lens over `PlanNode.metadata`**, never a schema field. Citations are written via the published `metadata-patch` edit verb — the `STRUCTURAL_FIELDS` guard means a citation write can never touch `id/parent_id/kind/ordinal/kind_ref`. **Any task that needs a kernel column/migration is a STOP — escalate; the reference relation graduates to a typed kernel `PlanNodeId` relation only on demonstrated ≥2-pack need (spec §9), never here.**
- **No `importRef`** — confirmed absent from `PlanNodeSchema`; the content pointer lives in `metadata.knowledge.contentRef` behind the `ContentPort` (D4). Never reuse `plan_node.importRef`.
- **No `effectDeclarations` on knowledge nodes** — the field is `.optional()` in the kernel schema; knowledge nodes simply omit it (§1).
- **Reserved metadata keys** — the typed contract lives under the single key `metadata.knowledge`; never use the kernel-reserved `__kindRef`/`__tenantPackId`. `kindRef` is set to `knowledge:<skinKind>` (non-empty, satisfies the kernel `.min(1)`). (The spec §3 JSONC shows the fields flat under `metadata`; nesting under `metadata.knowledge` is the namespace-safe implementation, exactly mirroring `metadata.charter` — recorded as a deviation in the S0 ADR.)
- **Derived graphs are NEVER stored (D3)** — `whoCites`/`impactOf` are rebuildable views over `cites[]`; the only persisted layer state is the pgvector `knowledge.retrieval_index` (a derived *cache*, rebuildable from the corpus + embeddings). The authoring surface is always `metadata.knowledge.cites[]`, never the index.
- **Layer-owned tables are RLS-scoped** — `knowledge.retrieval_index` ships in the layer's own `sql/knowledge-schema.sql` with a `tenant_pack_isolation` RLS policy keyed on the `app.tenant_pack_id` GUC (same posture as `kernel-plan-tree.sql`), driven by `GucPrismaRunner.run(tenantPackId, fn)` (the modern RLS entry, which sets the GUC in-transaction; `ScopedPrismaService` is deprecated per ADR-197). Tenancy is parametric (D7): domain corpora use a real `tenant_pack_id`; the cluster's own knowledge uses a reserved vendor-tier `tenant_pack_id` (never the literally-unscoped kernel-catalog posture).
- **Behaviour is declarative-only (D6)** — a pack-skin is config + bounded extension-point selection (+ the ADR-279 pure-data expression language where needed). A skin that ships code is a sub-pack, not a skin. Reject any skin task that would add executable behaviour to the skin descriptor.
- **Branch discipline** — feature branch in `layers/knowledge`; never `git add -A`; never git ops in shared clones.

---

## File Structure

```text
layers/knowledge/libs/knowledge-contracts/src/
├── knowledge-node.ts            KnowledgeContract zod + readKnowledge/writeKnowledge lens (Task 1)
├── knowledge-node.spec.ts
├── cites.ts                     CiteRelation enum + CiteEdge + addCite/derive helpers (Task 2)
├── cites.spec.ts
├── content-port.ts              ContentRef + ContentPort interface (Task 3)
├── content-port.spec.ts
├── retrieval-port.ts            RetrievalPort interface + query/result types (Task 5)
├── backlinks.ts                 whoCites + impactOf (pure, derived; Task 4)
├── backlinks.spec.ts
├── pack-skin.ts                 PackSkinDescriptor type + validator (Task 6)
├── pack-skin.spec.ts
└── index.ts                     barrel (extended each task)

layers/knowledge/libs/knowledge-runtime/src/
├── knowledge.module.ts          KnowledgeModule.forRoot (Task 7-wiring)
├── content/git-content.adapter.ts        (Task 3)
├── content/object-store-content.adapter.ts
├── content/fhir-content.adapter.ts       (stub: FHIR-aligned per spec §0 calibration)
├── retrieval/pgvector-retrieval.store.ts (Task 5)
├── retrieval/pgvector-retrieval.store.db.spec.ts
├── backlink-index.service.ts    derived backlink/impact cache over a corpus (Task 4)
├── corpus.service.ts            create/read knowledge nodes via PLAN_TREE_STORE (Task 1/2)
└── index.ts

layers/knowledge/sql/
└── knowledge-schema.sql         layer-owned: knowledge.retrieval_index + RLS (Task 5)

layers/knowledge/libs/knowledge-skins/src/    NEW lib (Task 6)
├── architecture-knowledge.skin.ts   foundry DN→T-ADR→S-ADR→E-ADR→Standard cascade
├── architecture-knowledge.skin.spec.ts
└── index.ts
```

---

### Task 1: The knowledge-node lens (TDD)

**Files:**

- Create: `libs/knowledge-contracts/src/knowledge-node.ts`
- Test: `libs/knowledge-contracts/src/knowledge-node.spec.ts`
- Modify: `libs/knowledge-contracts/src/index.ts`

**Interfaces:**

- Consumes: `PlanNode` (type) from `@de-braighter/substrate-contracts/plan-tree`.
- Produces:
  - `type KnowledgeLifecycle = 'draft' | 'active' | 'superseded' | 'archived'`
  - `interface ContentRef { adapter: string; locator: string }`
  - `interface KnowledgeContract { summary: string; contentRef: ContentRef; lifecycle: KnowledgeLifecycle; skin: string; cites?: CiteEdge[]; embeddingRef?: string }` (CiteEdge added in Task 2; here `cites` is typed `unknown[]`-tolerant and re-narrowed in Task 2 to avoid a forward import — see Step 3)
  - `KnowledgeContractSchema: ZodType<KnowledgeContract>`
  - `KNOWLEDGE_METADATA_KEY = 'knowledge'`
  - `readKnowledge(node: PlanNode): KnowledgeContract | null` — null if absent; **throws** if present-but-malformed (fail-closed)
  - `writeKnowledge(node: PlanNode, c: KnowledgeContract): PlanNode` — pure, non-mutating

- [ ] **Step 1: Write the failing test**

```typescript
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { readKnowledge, writeKnowledge, type KnowledgeContract } from './knowledge-node.js';

const baseNode = (): PlanNode => ({
  id: '11111111-1111-4111-8111-111111111111',
  parentId: null,
  treeRootId: '11111111-1111-4111-8111-111111111111',
  kind: 'knowledge.adr',
  kindRef: 'knowledge:adr',
  ordinal: 0,
  metadata: {},
  childrenIds: [],
});

const contract: KnowledgeContract = {
  summary: 'ADR-176 — kernel minimality inclusion test',
  contentRef: { adapter: 'git', locator: 'layers/specs/adr/adr-176-…md' },
  lifecycle: 'active',
  skin: 'architecture-knowledge',
};

describe('knowledge-node lens', () => {
  it('writeKnowledge then readKnowledge round-trips the contract', () => {
    expect(readKnowledge(writeKnowledge(baseNode(), contract))).toEqual(contract);
  });
  it('returns null when no knowledge contract is present', () => {
    expect(readKnowledge(baseNode())).toBeNull();
  });
  it('does not mutate the input node', () => {
    const n = baseNode();
    writeKnowledge(n, contract);
    expect(n.metadata).toEqual({});
  });
  it('throws when the knowledge key is present but malformed (fail-closed)', () => {
    const bad = { ...baseNode(), metadata: { knowledge: { summary: 'x' } } };
    expect(() => readKnowledge(bad as PlanNode)).toThrow();
  });
  it('a knowledge node carries no effectDeclarations', () => {
    expect(writeKnowledge(baseNode(), contract).effectDeclarations).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd layers/knowledge/libs/knowledge-contracts && pnpm exec vitest run src/knowledge-node.spec.ts`
Expected: FAIL — cannot find module `./knowledge-node.js`.

- [ ] **Step 3: Write `knowledge-node.ts`**

```typescript
import { z } from 'zod';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';

export const KnowledgeLifecycleSchema = z.enum(['draft', 'active', 'superseded', 'archived']);
export type KnowledgeLifecycle = z.infer<typeof KnowledgeLifecycleSchema>;

export const ContentRefSchema = z.object({
  adapter: z.string().min(1),   // 'git' | 'object-store' | 'fhir' | <skin-declared>
  locator: z.string().min(1),   // adapter-specific handle (path, key, FHIR ref)
});
export type ContentRef = z.infer<typeof ContentRefSchema>;

// `cites` is validated structurally here (array of objects) and re-narrowed by the
// CiteEdge schema in cites.ts via a refinement registered in Task 2 — keeping this
// file free of a forward import. The runtime always parses cites through CiteEdgeSchema.
export const KnowledgeContractSchema = z.object({
  summary: z.string().min(1),
  contentRef: ContentRefSchema,
  lifecycle: KnowledgeLifecycleSchema,
  skin: z.string().min(1),
  cites: z.array(z.record(z.unknown())).optional(),
  embeddingRef: z.string().optional(),
});
export type KnowledgeContract = z.infer<typeof KnowledgeContractSchema>;

export const KNOWLEDGE_METADATA_KEY = 'knowledge';

/** Absent → null; present-but-malformed → throws (fail-closed, mirrors readCharter). */
export function readKnowledge(node: PlanNode): KnowledgeContract | null {
  const raw = node.metadata[KNOWLEDGE_METADATA_KEY];
  if (raw === undefined) return null;
  return KnowledgeContractSchema.parse(raw);
}

export function writeKnowledge(node: PlanNode, contract: KnowledgeContract): PlanNode {
  return { ...node, metadata: { ...node.metadata, [KNOWLEDGE_METADATA_KEY]: contract } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/knowledge-node.spec.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Export + commit**

Append to `src/index.ts`: `export * from './knowledge-node.js';`
Run: `cd layers/knowledge && pnpm run ci:local`.

```bash
git add libs/knowledge-contracts/src/knowledge-node.ts libs/knowledge-contracts/src/knowledge-node.spec.ts libs/knowledge-contracts/src/index.ts
git commit -m "feat(knowledge-contracts): knowledge-node typed lens over PlanNode.metadata.knowledge"
```

---

### Task 2: Citation vocabulary — the stored generator (TDD)

**Files:**

- Create: `libs/knowledge-contracts/src/cites.ts`, `cites.spec.ts`
- Modify: `libs/knowledge-contracts/src/index.ts`

**Interfaces:**

- Consumes: `KnowledgeContract` (`./knowledge-node.js`).
- Produces:
  - `const CITE_RELATIONS = ['cites','supports','constrains','supersedes','derivedFrom','invalidates','implements','verifies','observed-by','decided-by','applies-to'] as const`
  - `type CiteRelation = (typeof CITE_RELATIONS)[number]`
  - `interface CiteEdge { target: string; relation: CiteRelation; locator?: string }` (target = a `PlanNodeId` or an external ref string; locator = e.g. "§Methods")
  - `CiteEdgeSchema: ZodType<CiteEdge>`
  - `readCites(contract: KnowledgeContract): CiteEdge[]` — parses `contract.cites` through `CiteEdgeSchema` (fail-closed)
  - `addCite(contract: KnowledgeContract, edge: CiteEdge): KnowledgeContract` — pure append (dedup by `target|relation`)

- [ ] **Step 1: Write the failing test** (relations enum closed; dedup; fail-closed parse):

```typescript
import { CITE_RELATIONS, readCites, addCite, type CiteEdge } from './cites.js';
import type { KnowledgeContract } from './knowledge-node.js';

const c = (cites?: unknown[]): KnowledgeContract => ({
  summary: 's', contentRef: { adapter: 'git', locator: 'x' }, lifecycle: 'active', skin: 'k',
  ...(cites ? { cites } : {}),
});

describe('citation vocabulary (stored generator)', () => {
  it('exposes the closed relation set', () => {
    expect(CITE_RELATIONS).toContain('derivedFrom');
    expect(CITE_RELATIONS).toContain('supersedes');
  });
  it('readCites parses well-formed edges', () => {
    const edges: CiteEdge[] = [{ target: 'B', relation: 'derivedFrom', locator: '§3' }];
    expect(readCites(c(edges))).toEqual(edges);
  });
  it('readCites is empty when no cites present', () => {
    expect(readCites(c())).toEqual([]);
  });
  it('readCites throws on an unknown relation (fail-closed)', () => {
    expect(() => readCites(c([{ target: 'B', relation: 'nope' }]))).toThrow();
  });
  it('addCite appends and dedups by target|relation', () => {
    const once = addCite(c(), { target: 'B', relation: 'cites' });
    const twice = addCite(once, { target: 'B', relation: 'cites' });
    expect(readCites(twice)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm exec vitest run src/cites.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Write `cites.ts`**

```typescript
import { z } from 'zod';
import { KnowledgeContractSchema, type KnowledgeContract } from './knowledge-node.js';

export const CITE_RELATIONS = [
  'cites', 'supports', 'constrains', 'supersedes', 'derivedFrom', 'invalidates',
  'implements', 'verifies', 'observed-by', 'decided-by', 'applies-to',
] as const;
export type CiteRelation = (typeof CITE_RELATIONS)[number];

export const CiteEdgeSchema = z.object({
  target: z.string().min(1),
  relation: z.enum(CITE_RELATIONS),
  locator: z.string().min(1).optional(),
});
export type CiteEdge = z.infer<typeof CiteEdgeSchema>;

export function readCites(contract: KnowledgeContract): CiteEdge[] {
  const raw = contract.cites ?? [];
  return z.array(CiteEdgeSchema).parse(raw);
}

export function addCite(contract: KnowledgeContract, edge: CiteEdge): KnowledgeContract {
  const parsed = CiteEdgeSchema.parse(edge);
  const existing = readCites(contract);
  const dup = existing.some((e) => e.target === parsed.target && e.relation === parsed.relation);
  const cites = dup ? existing : [...existing, parsed];
  // re-validate the whole contract so an invalid append fails closed
  return KnowledgeContractSchema.parse({ ...contract, cites });
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `pnpm exec vitest run src/cites.spec.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Export + commit**

Append to `src/index.ts`: `export * from './cites.js';`. Run `pnpm run ci:local` from the workspace root.

```bash
git add libs/knowledge-contracts/src/cites.ts libs/knowledge-contracts/src/cites.spec.ts libs/knowledge-contracts/src/index.ts
git commit -m "feat(knowledge-contracts): citation vocabulary (CiteEdge + closed relation set) as a stored generator"
```

---

### Task 3: ContentPort + adapters (TDD)

**Files:**

- Create: `libs/knowledge-contracts/src/content-port.ts`, `content-port.spec.ts`
- Create: `libs/knowledge-runtime/src/content/{git-content.adapter.ts,object-store-content.adapter.ts,fhir-content.adapter.ts}`
- Modify: both `index.ts` barrels

**Interfaces:**

- Produces (contracts):
  - `interface ContentFetch { bytes: Uint8Array; contentHash: string; mediaType?: string }`
  - `type ContentResult = { ok: true; value: ContentFetch } | { ok: false; error: { kind: 'not-found' | 'unreachable' | 'forbidden'; detail: string } }`
  - `interface ContentPort { resolve(ref: ContentRef): Promise<ContentResult> }`
  - `const CONTENT_PORT: unique symbol = Symbol.for('@de-braighter/knowledge-contracts/CONTENT_PORT')`
- Produces (runtime): `GitContentAdapter` (reads a repo-relative path), `ObjectStoreContentAdapter` (key→bytes), `FhirContentAdapter` (stub returning `not-found` — FHIR-aligned per spec §0 calibration; real adapter deferred).

- [ ] **Step 1: Write the failing contract test** (a fake adapter proves the port compiles + is usable; content hash uses the S0 `content-hash`):

```typescript
import type { ContentPort, ContentResult } from './content-port.js';
import type { ContentRef } from './knowledge-node.js';
import { sha256Hex } from './content-hash.js';

class FakeContent implements ContentPort {
  async resolve(ref: ContentRef): Promise<ContentResult> {
    if (ref.locator === 'missing') return { ok: false, error: { kind: 'not-found', detail: ref.locator } };
    const bytes = new TextEncoder().encode(`body:${ref.locator}`);
    return { ok: true, value: { bytes, contentHash: sha256Hex(`body:${ref.locator}`), mediaType: 'text/markdown' } };
  }
}

describe('ContentPort', () => {
  it('resolves a content ref to provenance-stamped bytes', async () => {
    const r = await new FakeContent().resolve({ adapter: 'git', locator: 'a.md' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('returns a typed not-found error', async () => {
    const r = await new FakeContent().resolve({ adapter: 'git', locator: 'missing' });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `content-port.ts`** (the interface + token; `ContentRef` re-exported from `knowledge-node.ts`). Run the test → PASS.

- [ ] **Step 3: Write the runtime adapters.** `GitContentAdapter.resolve` reads `ref.locator` as a repo-relative path (`node:fs/promises.readFile`), hashes with `sha256Hex` (from `@de-braighter/knowledge-contracts`), returns `{ bytes, contentHash, mediaType }`; maps `ENOENT` → `not-found`. `ObjectStoreContentAdapter` takes an injected `get(key): Promise<Uint8Array|null>`. `FhirContentAdapter` returns `{ ok:false, error:{ kind:'not-found', detail:'fhir adapter deferred (FHIR-aligned)'} }`. Each adapter has a unit spec (fixture file for git; injected map for object-store).

- [ ] **Step 4: Run the runtime tests + gate.** Run `cd layers/knowledge && pnpm run ci:local` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/knowledge-contracts/src/content-port.ts libs/knowledge-contracts/src/content-port.spec.ts libs/knowledge-runtime/src/content libs/knowledge-contracts/src/index.ts libs/knowledge-runtime/src/index.ts
git commit -m "feat(knowledge): ContentPort + git/object-store/fhir(stub) adapters (content behind a pluggable port, D4)"
```

---

### Task 4: Derived backlink index + impact set (TDD)

**Files:**

- Create: `libs/knowledge-contracts/src/backlinks.ts`, `backlinks.spec.ts`
- Create: `libs/knowledge-runtime/src/backlink-index.service.ts` (+ spec)
- Modify: barrels

**Interfaces:**

- Produces (contracts, PURE — D3 "derived, never stored"):
  - `interface NodeWithCites { id: string; cites: CiteEdge[] }`
  - `whoCites(corpus: readonly NodeWithCites[], target: string): { id: string; relation: CiteRelation }[]` — the backlink view
  - `impactOf(corpus: readonly NodeWithCites[], target: string): string[]` — transitive impact set (closure over inbound edges; cycle-safe)
- Produces (runtime): `BacklinkIndexService` — builds the two views from a loaded corpus and caches them in-memory (rebuildable from `cites[]`; the cache is NEVER the authoring surface).

- [ ] **Step 1: Write the failing test**

```typescript
import { whoCites, impactOf, type NodeWithCites } from './backlinks.js';

const corpus: NodeWithCites[] = [
  { id: 'A', cites: [{ target: 'B', relation: 'derivedFrom' }] },
  { id: 'C', cites: [{ target: 'B', relation: 'cites' }] },
  { id: 'D', cites: [{ target: 'A', relation: 'supports' }] },
  { id: 'B', cites: [] },
];

describe('derived reference views (never stored)', () => {
  it('whoCites returns the inbound citers of a target', () => {
    expect(whoCites(corpus, 'B').map((x) => x.id).sort()).toEqual(['A', 'C']);
  });
  it('impactOf returns the transitive inbound closure', () => {
    // B is cited by A and C; A is cited by D → impact(B) = {A, C, D}
    expect(impactOf(corpus, 'B').sort()).toEqual(['A', 'C', 'D']);
  });
  it('impactOf is cycle-safe', () => {
    const cyc: NodeWithCites[] = [
      { id: 'X', cites: [{ target: 'Y', relation: 'cites' }] },
      { id: 'Y', cites: [{ target: 'X', relation: 'cites' }] },
    ];
    expect(impactOf(cyc, 'X').sort()).toEqual(['X', 'Y']);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `backlinks.ts`** (pure functions; `impactOf` = BFS over an inbound adjacency map built from `cites`, `visited` set for cycle safety). Run → PASS.

- [ ] **Step 3: Write `BacklinkIndexService`** — `build(corpus)` derives + caches `whoCites`/`impactOf` keyed by target; `rebuild()` recomputes from a fresh corpus load. Document in a comment: this is a derived cache, never authoritative; on any `cites[]` write the cache is invalidated/rebuilt (S2 wires the stale-propagation worker to it). Unit-test the cache hit + invalidation.

- [ ] **Step 4: Gate + commit**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-contracts/src/backlinks.ts libs/knowledge-contracts/src/backlinks.spec.ts libs/knowledge-runtime/src/backlink-index.service.ts libs/knowledge-runtime/src/backlink-index.service.spec.ts libs/knowledge-contracts/src/index.ts libs/knowledge-runtime/src/index.ts
git commit -m "feat(knowledge): derived backlink index (whoCites) + transitive impact set (D3: derived, never stored)"
```

---

### Task 5: Layer-owned pgvector retrieval index (TDD + DB)

**Files:**

- Create: `libs/knowledge-contracts/src/retrieval-port.ts` (+ spec)
- Create: `layers/knowledge/sql/knowledge-schema.sql`
- Create: `libs/knowledge-runtime/src/retrieval/pgvector-retrieval.store.ts`
- Test: `libs/knowledge-runtime/src/retrieval/pgvector-retrieval.store.db.spec.ts`

**Interfaces:**

- Produces (contracts):
  - `interface RetrievalRecord { nodeId: string; treeRootId: string; embedding: readonly number[]; summary: string }`
  - `interface RetrievalQuery { embedding: readonly number[]; k: number; treeRootId?: string }`
  - `interface RetrievalHit { nodeId: string; score: number; summary: string }`
  - `interface RetrievalPort { upsert(rec: RetrievalRecord): Promise<void>; query(q: RetrievalQuery): Promise<RetrievalHit[]> }`
  - `const RETRIEVAL_PORT: unique symbol = Symbol.for('@de-braighter/knowledge-contracts/RETRIEVAL_PORT')`
  - `const EMBEDDING_DIM = 1536` (OQ3 default — make configurable via `KnowledgeModule.forRoot({ embeddingDim })`; record the chosen model/dim in the S0 ADR follow-up)

- [ ] **Step 1: De-risk pgvector availability FIRST.** Confirm the substrate DB-test harness Postgres has (or can `CREATE EXTENSION`) `vector`:

```bash
cd D:/development/projects/de-braighter/layers/substrate
npm run db:setup   # the shared test DB
psql "$SUBSTRATE_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname='vector';"
```

Expected: a version row. **If `vector` is not installable** (image lacks it), STOP and escalate — either the shared dev-Docker Postgres image needs pgvector (a `layers/platform` change, founder decision) or S1's retrieval index falls back to a non-vector cosine-in-SQL interim with a debt item. Record the path taken.

- [ ] **Step 2: Write the layer-owned schema** `sql/knowledge-schema.sql` (mirror `substrate-runtime/sql/kernel-plan-tree.sql`'s RLS posture — own schema, RLS on the `app.tenant_pack_id` GUC):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS knowledge;

CREATE TABLE IF NOT EXISTS knowledge.retrieval_index (
  node_id        uuid PRIMARY KEY,
  tree_root_id   uuid NOT NULL,
  tenant_pack_id uuid NOT NULL,
  summary        text NOT NULL,
  embedding      vector(1536) NOT NULL,         -- EMBEDDING_DIM; keep in sync with forRoot
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_retrieval_tree
  ON knowledge.retrieval_index (tenant_pack_id, tree_root_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_retrieval_embedding
  ON knowledge.retrieval_index USING hnsw (embedding vector_cosine_ops);

ALTER TABLE knowledge.retrieval_index ENABLE ROW LEVEL SECURITY;
-- tenant_pack_isolation: keyed on the per-request GUC set by ScopedPrismaService
CREATE POLICY tenant_pack_isolation ON knowledge.retrieval_index
  USING (tenant_pack_id = current_setting('app.tenant_pack_id', true)::uuid)
  WITH CHECK (tenant_pack_id = current_setting('app.tenant_pack_id', true)::uuid);
-- grant to the pack app-role (mirror substrate-runtime/sql/app-roles.sql conventions)
```

- [ ] **Step 3: Write the failing DB round-trip test** (`describe.skipIf(!DATABASE_URL)`, mirroring `prisma-plan-tree.store.db.spec.ts`): insert two records under a tenant via `GucPrismaRunner.run(tenantPackId, tx => ...)` (sets the `app.tenant_pack_id` GUC in-transaction), query top-k by cosine distance, assert the nearer embedding ranks first AND that a row under a DIFFERENT `tenant_pack_id` is invisible (RLS proof). Use raw SQL through the scoped tx client for the `vector` literal.

- [ ] **Step 4: Write `retrieval-port.ts` + `PgvectorRetrievalStore`** implementing `RetrievalPort` over the scoped client (`upsert` = `INSERT … ON CONFLICT (node_id) DO UPDATE`; `query` = `ORDER BY embedding <=> $1 LIMIT k`, returning `1 - distance` as `score`). Embeddings themselves are computed by an injected `EmbeddingPort` (declared here, implemented as a deferred/stub adapter — OQ3; the async refresh worker is S2).

- [ ] **Step 5: Run the DB test under the db tier**

```bash
npx vitest run -c libs/knowledge-runtime/vitest.db.config.ts libs/knowledge-runtime/src/retrieval/pgvector-retrieval.store.db.spec.ts
```

Expected: PASS (not skipped). The RLS sub-assertion is non-negotiable — a cross-tenant read MUST return zero rows.

- [ ] **Step 6: Commit**

```bash
git add libs/knowledge-contracts/src/retrieval-port.ts sql libs/knowledge-runtime/src/retrieval
git commit -m "feat(knowledge): layer-owned pgvector retrieval index (RetrievalPort + RLS-scoped knowledge.retrieval_index)"
```

---

### Task 6: pack-skin descriptor + the architecture-knowledge skin (TDD)

**Files:**

- Create: `libs/knowledge-contracts/src/pack-skin.ts` (+ spec)
- Create: `libs/knowledge-skins/` (new lib: package.json, tsconfigs, vitest, src/index.ts) + `src/architecture-knowledge.skin.ts` (+ spec)
- Modify: root `pnpm-workspace.yaml` already globs `libs/*`

**Interfaces:**

- Produces (contracts):
  - `interface PackSkinKind { kind: string; kindRef: string; summary: string }` (the declared document kinds)
  - `interface PackSkinDescriptor { name: string; kinds: PackSkinKind[]; lifecycle: KnowledgeLifecycle[]; allowedRelations: CiteRelation[]; contentAdapter: string; capture: 'authored' | 'extracted' | 'both' }`
  - `PackSkinDescriptorSchema: ZodType<PackSkinDescriptor>` — **declarative-only (D6)**: the schema rejects any function-valued field (config + bounded selection only).
  - `validatePackSkin(d: unknown): PackSkinDescriptor` (fail-closed)

- [ ] **Step 1: Write the failing test for the descriptor** — a valid descriptor parses; a descriptor with an unknown relation, an unknown lifecycle, or (key D6 check) a function-valued field is rejected.

- [ ] **Step 2: Write `pack-skin.ts`** — the Zod schema (relations ⊆ `CITE_RELATIONS`, lifecycle ⊆ `KnowledgeLifecycle`, `capture` enum). Add a refinement asserting no value in the descriptor is a function (declarative-only).

- [ ] **Step 3: Scaffold `libs/knowledge-skins`** (mirror knowledge-contracts package.json; dep on `@de-braighter/knowledge-contracts` `workspace:*`). Write the failing test for `architectureKnowledgeSkin`.

- [ ] **Step 4: Write `architecture-knowledge.skin.ts`** — the foundry cascade (spec §7) as pure data:

```typescript
import { validatePackSkin, type PackSkinDescriptor } from '@de-braighter/knowledge-contracts';

// Design Note → Technical ADR → Solution ADR → Enterprise ADR → Standard/Principle/Ref-Arch/Strategy
export const architectureKnowledgeSkin: PackSkinDescriptor = validatePackSkin({
  name: 'architecture-knowledge',
  kinds: [
    { kind: 'knowledge.design-note', kindRef: 'knowledge:design-note', summary: 'Design Note (DN)' },
    { kind: 'knowledge.t-adr',       kindRef: 'knowledge:t-adr',       summary: 'Technical ADR' },
    { kind: 'knowledge.s-adr',       kindRef: 'knowledge:s-adr',       summary: 'Solution ADR' },
    { kind: 'knowledge.e-adr',       kindRef: 'knowledge:e-adr',       summary: 'Enterprise ADR' },
    { kind: 'knowledge.standard',    kindRef: 'knowledge:standard',    summary: 'Standard / Principle / Reference Architecture / Strategy' },
  ],
  lifecycle: ['draft', 'active', 'superseded', 'archived'],
  allowedRelations: ['derivedFrom', 'constrains', 'supersedes', 'implements', 'decided-by', 'applies-to'],
  contentAdapter: 'git',   // ADRs/specs are git markdown files
  capture: 'both',         // authored crossRefs + extracted from doc bodies
});
```

(Authority/role/gate semantics — who authors vs ratifies — are deliberately NOT here; they are a separate SDLC pack-skin concern per spec §7/§11.)

- [ ] **Step 5: Write the end-to-end demonstrator spec** (the first-consumer proof, folding in §7). A test that, on a small in-memory corpus of foundry-shaped nodes (an E-ADR, two T-ADRs `derivedFrom` it, a DN `implements` a T-ADR), each written with `writeKnowledge` under `architectureKnowledgeSkin`'s kinds:
  - round-trips through `PrismaPlanTreeStore` (fake delegate, like charter-runtime's `kernel-roundtrip.spec.ts`) — proves knowledge nodes are kernel-store-ready with zero kernel change;
  - `whoCites(corpus, eAdrId)` returns the two T-ADRs;
  - `impactOf(corpus, eAdrId)` includes the DN (transitive);
  - every node passes `PlanTreeSchema.parse` and carries no `effectDeclarations`.

- [ ] **Step 6: Gate + commit**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-contracts/src/pack-skin.ts libs/knowledge-skins
git commit -m "feat(knowledge): pack-skin descriptor (declarative-only) + foundry architecture-knowledge skin (first consumer, spec §7)"
```

---

### Task 7: KnowledgeModule wiring + corpus service + boundary acid

**Files:**

- Create: `libs/knowledge-runtime/src/knowledge.module.ts`, `corpus.service.ts` (+ specs)
- Create: `libs/knowledge-runtime/src/boundary-acid.spec.ts` (runtime variant)

**Interfaces:**

- Produces: `KnowledgeModule.forRoot({ embeddingDim, contentAdapters, vendorTenantPackId? })` binding `CONTENT_PORT`, `RETRIEVAL_PORT`, `BacklinkIndexService`, `CorpusService`. `CorpusService` creates/reads knowledge nodes via the injected `PLAN_TREE_STORE` (writes citations via the `metadata-patch` edit verb so structure is untouched) and registers retrieval records via `RETRIEVAL_PORT`.

- [ ] **Step 1: Decide the skin home** (Task intro). Default: ship `architecture-knowledge` as a reference skin in `libs/knowledge-skins` (published); foundry wires it after its substrate bump. Record the decision.

- [ ] **Step 2: Write `CorpusService`** — `createNode(treeRootId, parentId, kind, kindRef, contract)` builds a `PlanNode` with `writeKnowledge`, persists via `PLAN_TREE_STORE.save`/`applyEdit`; `addCitation(nodeId, edge)` issues a `metadata-patch` edit (`op:'add'`, `path:'/metadata/knowledge/cites/-'`) — assert via a unit test that the patch never touches a `STRUCTURAL_FIELDS` path (re-use the published `findStructuralFieldViolation`). Confirm the exact `PrismaPlanTreeStore` constructor signature at execution (`new PrismaPlanTreeStore(prisma, { tenantPackId, userId })`, per charter-runtime).

- [ ] **Step 3: Write the runtime boundary-acid** (same shape as S0's, scanning `knowledge-runtime/src`): production source imports substrate only via published `@de-braighter/substrate-{contracts,runtime}` (+ subpaths); no relative reach into the substrate repo; no kernel column references.

- [ ] **Step 4: Gate + push + commit**

```bash
cd layers/knowledge && pnpm run ci:local
git add libs/knowledge-runtime/src/knowledge.module.ts libs/knowledge-runtime/src/corpus.service.ts libs/knowledge-runtime/src/boundary-acid.spec.ts
git commit -m "feat(knowledge-runtime): KnowledgeModule.forRoot + CorpusService (citations via metadata-patch; structure untouched)"
git push -u origin feat/s1-document-management
```

---

### Task 8: PR + verifier wave

- [ ] **Step 1: Open `de-braighter/knowledge#<n>`** (branch `feat/s1-document-management`). PR body lists the S1 deliverables + the twin-ritual lines:

```text
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert; findings <one per 200 LoC>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 2: Verifier wave** (non-trivial: new endpoints/services + a schema/migration + cross-component) → full wave in parallel, `isolation: "worktree"`: `local-ci` + `reviewer` + `charter-checker` + `qa-engineer`. `charter-checker` certifies: derived graphs not stored (D3), no kernel change (boundary-acid + no substrate diff), references stay layer-side (§9). `qa-engineer` checks the RLS proof on `knowledge.retrieval_index`, the metadata-patch structural guard, and that no heavy compute is on the request path (deferred to S2 — flag if any synchronous embedding/impact compute leaks into a handler here). Post findings before merge; then `npm run ritual:post-merge`.

---

## Self-Review

**Spec coverage (S1):** §1 knowledge nodes on one tree → Task 1. §3 metadata shape (summary/contentRef/lifecycle/skin/cites/embeddingRef) → Tasks 1/2/5. §4 stored generator `cites[]` + derived `whoCites`/`impactOf` → Tasks 2/4. D4 ContentPort (not importRef) → Task 3. pgvector retrieval (layer-owned table, RLS) → Task 5. §5 pack-skin → Task 6. §6 S1 "find the doc + where it's cited" → Tasks 4/5/7. §7 foundry architecture-knowledge skin (first consumer) → Task 6/7. D3 derived-never-stored, D6 declarative-only, D7 parametric tenancy → Global Constraints + Tasks 4/5/6. OQ1 (sub-document granularity) → handled: a node is a document; sections are optional child nodes a skin may add (the architecture-knowledge skin uses document-grain only — noted). OQ3 (embedding) → `EMBEDDING_DIM` default + configurable, recorded for the ADR. S2/S3 concerns (observation events, posteriors, async workers, provenance) are explicitly out of S1.

**Placeholder scan:** no TBD/TODO; load-bearing contract code is complete; runtime adapter/DB tasks specify exact SQL + the confirm-at-execution steps (pgvector availability, `PrismaPlanTreeStore` signature) that the house style uses for substrate/DB integration.

**Type consistency:** `KnowledgeContract`/`ContentRef`/`readKnowledge`/`writeKnowledge` (Task 1) used in 2/3/6/7; `CiteEdge`/`CiteRelation`/`readCites`/`addCite` (Task 2) used in 4/6; `ContentPort`/`CONTENT_PORT` (Task 3) bound in 7; `whoCites`/`impactOf` (Task 4) used in 6/7; `RetrievalPort`/`RETRIEVAL_PORT`/`EMBEDDING_DIM` (Task 5) bound in 7; `PackSkinDescriptor`/`validatePackSkin` (Task 6) used by the skin + 7.

## Risks / open questions

- **pgvector in the shared dev Postgres** is the top execution risk (Task 5 Step 1 de-risk + fallback). If unavailable it is a `layers/platform` image change (founder decision), not a knowledge-layer workaround.
- **OQ3 embedding model/dim** is pinned to a default (1536) and made configurable; the real model + refresh cadence land with the S2 async refresh worker.
- **Skin home** (layer reference skin vs in-foundry) is decided in Task 7 Step 1 to avoid re-coupling foundry to the layer before its substrate-contracts bump (the S0 risk).
