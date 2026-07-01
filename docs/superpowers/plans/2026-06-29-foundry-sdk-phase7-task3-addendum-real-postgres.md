# Phase 7 — Task 3 Addendum: Real Postgres binding (consume canonical PrismaPlanTreeStore)

> Supersedes the original Task 3 + Task 4 in `2026-06-29-foundry-sdk-phase7-persist-knowledge-node.md`.
> Decision (user, 2026-06-29): **Real Postgres binding**, **consume the canonical store** (bump
> substrate-contracts + add substrate-runtime, lazy dynamic import). The contracts bump (Task 3a)
> is already merged on the branch (commit `7006f84`, full suite green 1168/1).

**Working directory for all commands:** `D:/development/projects/de-braighter/domains/foundry`
**Branch:** `feat/foundry-phase7-persist-knowledge-node`

## Verified facts (do not re-investigate)

- foundry now resolves `@de-braighter/substrate-contracts` **2.8.0** (bumped from 0.10.0; full suite green).
- Prisma version across the cluster: **^5.22.0** (`prisma` CLI + `@prisma/client`), `multiSchema` preview.
- `PrismaPlanTreeStore` is exported from the **root** `@de-braighter/substrate-runtime` (via `export * from './plan-tree/index.js'`). Importing the root drags NestJS at eval → **must** be a LAZY dynamic import.
- Constructor: `new PrismaPlanTreeStore(prismaClientLike, { tenantPackId, userId })` where `prismaClientLike` is a real `PrismaClient` cast through `unknown` (mirrors substrate's own `prisma-plan-tree.store.db.spec.ts`). No GUC runner needed for the round-trip; strict RLS isolation (app role + GUC) is a deployment concern, documented as a known limitation.
- The store reads/writes exactly: `id, tenant_pack_id, tree_root_id, parent_id, ordinal, depth, kind, kind_ref(null), tier('vendor'), title, effects?(omitted when empty), metadata, created_by`. Auto: `created_at/updated_at`. Filter: `deleted_at IS NULL`.
- foundry's `twin/` is an isolated sub-package (own `package.json`, generates to `.prisma/devloop-client`) → a root `prisma/schema.prisma` with **default** client output does not collide.
- **FK trap:** the knowledge skin sets `parentId = spec.parentId ?? ctx.parentNodeId` and `ctx.parentNodeId` is a random UUID. Persisting that violates the `parent_id` FK. A root knowledge node MUST be generated with `parentId: null` (the DB test does this).
- **UUID columns:** `tenant_pack_id` + `created_by` are `@db.Uuid`. The DB path must use UUID-shaped tenant/user ids, NOT the `'foundry-mcp'` string.

---

## Task 3b: Prisma schema + deps + generate wiring

**Goal:** Give foundry a generated Prisma client over `kernel.plan_node` (read/write only; foundry never migrates that table) so the canonical store can bind.

### Step 1 — Create `prisma/schema.prisma`

```prisma
// foundry / prisma / schema.prisma
// ─────────────────────────────────────────────────────────────────────────
// A THIN read/write client over the substrate kernel.plan_node table — owned,
// migrated, and RLS-governed by @de-braighter/substrate. Foundry does NOT own
// or migrate this table; it only generates a client so the published
// PrismaPlanTreeStore (substrate-runtime) can persist gen_generate kind=knowledge
// PlanNodes to kernel.plan_node (Phase 7).
//
// The model mirrors EXACTLY the column subset PrismaPlanTreeStore.PlanNodeRecord
// reads/writes (substrate-runtime/src/plan-tree/prisma-plan-tree.store.ts).
// Kernel-only columns (description, import_ref, conditions, capabilities,
// catalog_version_hash) are intentionally OMITTED — they are nullable / have DB
// defaults, so INSERTs from this client leave them NULL/default. Constraints,
// RLS policies, GIN/partial indexes, and the acyclic trigger live in substrate's
// migration.sql, never here.
// ─────────────────────────────────────────────────────────────────────────

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("SUBSTRATE_DATABASE_URL")
  schemas  = ["kernel"]
}

/// Thin projection of kernel.plan_node — the column subset PrismaPlanTreeStore
/// reads (findMany) and writes (createMany). @@map + @map mirror the substrate
/// kernel schema so reads/writes align with rows the kernel itself writes.
model PlanNode {
  id           String    @id @default(uuid()) @db.Uuid
  tenantPackId String    @map("tenant_pack_id") @db.Uuid
  treeRootId   String    @map("tree_root_id") @db.Uuid
  parentId     String?   @map("parent_id") @db.Uuid
  ordinal      Int       @default(0)
  depth        Int       @default(0)
  kind         String
  kindRef      String?   @map("kind_ref") @db.Uuid
  tier         String    @default("vendor")
  title        String
  effects      Json?
  metadata     Json      @default("{}")
  createdBy    String    @map("created_by") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt    DateTime  @updatedAt        @map("updated_at") @db.Timestamptz()
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz()

  @@map("plan_node")
  @@schema("kernel")
}
```

### Step 2 — Update `package.json`

Add to `dependencies`:
```json
"@de-braighter/substrate-runtime": "^2.7.0",
"@prisma/client": "^5.22.0",
```
Add to `devDependencies`:
```json
"prisma": "^5.22.0",
```
Add to `scripts`:
```json
"prisma:generate": "prisma generate",
"postinstall": "prisma generate"
```
(`prisma generate` reads only the schema — it never connects to a DB — so `postinstall` is deterministic and safe with `SUBSTRATE_DATABASE_URL` unset.)

### Step 3 — Install + generate

```bash
npm install
npx prisma generate
```
Expected: install succeeds; `prisma generate` writes the client to `node_modules/.prisma/client` (default output, gitignored under node_modules — no `.gitignore` change needed). If `npm install` already ran `postinstall`, the explicit generate is a confirming no-op.

### Step 4 — Typecheck

```bash
npm run typecheck
```
Expected: clean (the generated `@prisma/client` types now resolve).

### Step 5 — Commit

```bash
git add package.json package-lock.json prisma/schema.prisma
git commit -m "feat(phase7-s3b): prisma client over kernel.plan_node + @prisma/client + substrate-runtime deps"
```

---

## Task 3c: Bind PrismaPlanTreeStore in `server.ts` (lazy) + DB-gated round-trip test

**Goal:** When `SUBSTRATE_DATABASE_URL` is set, construct the canonical `PrismaPlanTreeStore` (lazy, so NestJS only loads on the DB path) and pass it to `makeGenTools`. Prove the real round-trip with a DB-gated test.

### Step 1 — Update `src/mcp/server.ts`

Add this import near the top (type-only, no eval cost):
```typescript
import type { PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
```

In `main()`, REPLACE the existing `gen` construction:
```typescript
const gen = makeGenTools({ dataDir: DEFAULT_DATA_DIR, logPath: DEFAULT_LOG, useCoreFoundry });
```
with:
```typescript
// Phase 7 — when a substrate DB is configured, bind the canonical kernel.plan_node
// store so gen_generate kind=knowledge persists. LAZY dynamic import: the NestJS-heavy
// runtime + @prisma/client load ONLY on the DB path, keeping the no-DB stdio startup light.
const dbUrl = process.env['SUBSTRATE_DATABASE_URL'];
// kernel.plan_node tenant_pack_id + created_by are @db.Uuid — these MUST be UUIDs.
const tenantPackId = process.env['FOUNDRY_TENANT_PACK_ID'] ?? '00000000-0000-4000-8000-000000000000';
const userId = process.env['FOUNDRY_USER_ID'] ?? '00000000-0000-4000-8000-000000000001';
let planTreeStore: PlanTreeStore | undefined;
if (dbUrl) {
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPlanTreeStore } = await import('@de-braighter/substrate-runtime');
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  planTreeStore = new PrismaPlanTreeStore(
    prisma as unknown as ConstructorParameters<typeof PrismaPlanTreeStore>[0],
    { tenantPackId, userId },
  );
}
const gen = makeGenTools({
  dataDir: DEFAULT_DATA_DIR,
  logPath: DEFAULT_LOG,
  useCoreFoundry,
  store: planTreeStore,
  tenantPackId,
});
```

### Step 2 — Create `src/mcp/gen-tools.db.spec.ts` (DB-gated)

Mirror substrate's `prisma-plan-tree.store.db.spec.ts` (skip when no DB). Prove the FULL path:
`makeGenTools({store})` → `gen_generate kind=knowledge` (with `parentId: null`) → the node is in `kernel.plan_node` (load it back via the same store).

```typescript
// DB-INTEGRATION: proves gen_generate kind=knowledge persists a PlanNode to the
// real kernel.plan_node via the canonical PrismaPlanTreeStore. Skips when no DB.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeGenTools } from './gen-tools.js';

const DATABASE_URL = process.env['SUBSTRATE_DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('gen_generate kind=knowledge — real kernel.plan_node round-trip', () => {
  const TENANT = randomUUID();
  const USER = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let store: any;
  let createdTreeRootId: string | undefined;

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    const { PrismaPlanTreeStore } = await import('@de-braighter/substrate-runtime');
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    store = new PrismaPlanTreeStore(prisma, { tenantPackId: TENANT, userId: USER });
  }, 60_000);

  afterAll(async () => {
    if (prisma && createdTreeRootId) {
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM kernel.plan_node WHERE tree_root_id = $1::uuid`,
          createdTreeRootId,
        );
      } catch { /* best-effort */ }
    }
    if (prisma) await prisma.$disconnect();
  });

  it('persists the generated knowledge node and loads it back from kernel.plan_node', async () => {
    const tools = makeGenTools({ logPath: ':memory:', dataDir: '/tmp', store, tenantPackId: TENANT });
    const model = {
      title: 'Phase 7 DB round-trip',
      knowledgeKind: 'design-note',
      contract: {
        summary: 'persisted to kernel.plan_node',
        contentRef: { adapter: 'inline', locator: 'db-test' },
        cites: [],
        lifecycle: 'draft',
        skin: 'knowledge',
      },
      parentId: null, // ROOT node — avoids the parent_id FK (ctx.parentNodeId is synthetic)
    };
    const result = await tools.gen_generate({ kind: 'knowledge', model, claimRef: 'db-claim' });
    expect(result.isError).toBeFalsy();
    const node = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    createdTreeRootId = node.treeRootId;

    const loaded = await store.load(node.treeRootId);
    expect(loaded).not.toBeNull();
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0].id).toBe(node.id);
    expect(loaded.nodes[0].kind).toBe('knowledge.design-note');
    expect(loaded.nodes[0].metadata.title).toBe('Phase 7 DB round-trip');
    expect(loaded.nodes[0].metadata.knowledge.summary).toBe('persisted to kernel.plan_node');
  });
});
```

### Step 3 — Typecheck + tests

```bash
npm run typecheck
npm run test
```
Expected: typecheck clean; all tests pass. The new DB-gated test **skips** without `SUBSTRATE_DATABASE_URL` (so CI stays green with no DB). If a substrate Postgres with the kernel schema is reachable, set `SUBSTRATE_DATABASE_URL` and confirm the round-trip test passes.

### Step 4 — Commit

```bash
git add src/mcp/server.ts src/mcp/gen-tools.db.spec.ts
git commit -m "feat(phase7-s3c): bind canonical PrismaPlanTreeStore in server.ts (lazy) + DB-gated kernel.plan_node round-trip test"
```

---

## Known limitations (document in PR, defer to Phase 8)

- **RLS isolation:** the round-trip binds the store without a GUC runner (mirrors substrate's own db.spec). Strict per-tenant isolation needs the `app` role + `app.tenant_pack_id` GUC; with an owner/admin connection RLS is bypassed. Fine for a single-tenant foundry MCP; multi-tenant hardening is Phase 8.
- **Root-node-only persist:** DB-persisted knowledge generation must pass `parentId: null` (or a real existing parent id) to avoid the `parent_id` FK. Attaching to a synthetic `ctx.parentNodeId` is not DB-safe. Skin-default semantics are a foundry-core concern, out of Phase 7 scope.
