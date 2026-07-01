# Foundry Phase 8 — Item 4: RLS isolation hardening

**Status:** In progress  
**Repo:** `domains/foundry`  
**Branch:** `feat/foundry-phase8-item4-rls-isolation`

## Goal

Bind the `app` role + `app.tenant_pack_id` GUC so the store's writes to `kernel.plan_node`
are tenant-isolated, not owner-bypass. Currently `server.ts` creates a `PrismaClient` using
the `postgres` superuser (SUBSTRATE_DATABASE_URL), which bypasses all RLS policies.

## Architecture decision (concierge 2026-06-29)

**Is this achievable domain-side?** YES — `applyLayerTenantGuc` is in
`@de-braighter/substrate-contracts/layer-rls` (already a dep of foundry). No NestJS. No
kernel touch.

| Question | Decision |
|---|---|
| Kernel touch? | NO — consuming existing published API (`applyLayerTenantGuc` + `LayerRlsRunner` from substrate-contracts) |
| ADR-176 | PASS — existing port consumer, zero new kernel primitive |
| ADR-027 | PASS — domain-side only |
| ADR-284 | This IS the ADR-284 pattern (`applyLayerTenantGuc` + app role) |
| New file | `src/mcp/rls-plan-tree-store.ts` in domains/foundry |
| Breaking change? | NO — opt-in (uses `SUBSTRATE_APP_DATABASE_URL` env var; falls back to existing owner-bypass if absent) |
| New ADR? | No — consuming an existing ratified pattern |

**Pattern:** wrap `PrismaPlanTreeStore.$transaction` to inject the GUC inside the same
transaction, using the `app` role connection (NOBYPASSRLS).

## How the wrapper works

`PlanTreePrismaClient.$transaction(fn)` gives `fn` a tx handle. The store calls
`tx.planNode.deleteMany` + `tx.planNode.createMany` on it. Our wrapper intercepts `$transaction`,
runs the REAL Prisma transaction, calls `applyLayerTenantGuc(tx as RawPrismaLike, tenantPackId)`
FIRST, then passes the tx to `fn`.

The real Prisma tx handle satisfies both `RawPrismaLike` (has `$executeRawUnsafe`) and
`PlanTreePrismaClient` (has `.planNode`). The cast is safe — structural TypeScript typing.

## Implementation

### Task 1: Create `src/mcp/rls-plan-tree-store.ts`

```typescript
// Domain-side RLS wrapper — sets app.tenant_pack_id GUC inside every PrismaPlanTreeStore
// transaction so writes to kernel.plan_node are tenant-isolated when using the app role.
// No kernel touch: applyLayerTenantGuc is from @de-braighter/substrate-contracts/layer-rls.
import type { PlanTree, PlanTreeEdit, PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import {
  applyLayerTenantGuc,
  type RawPrismaLike,
  type TransactionalPrismaLike,
} from '@de-braighter/substrate-contracts/layer-rls';
import type { PlanTreePrismaClient } from '@de-braighter/substrate-runtime';
import { PrismaPlanTreeStore } from '@de-braighter/substrate-runtime';

/**
 * Wraps PrismaPlanTreeStore to inject the app.tenant_pack_id GUC inside every
 * transaction. Requires an app-role Prisma client (NOBYPASSRLS) — pairing this
 * with an owner/superuser client negates the RLS benefit (owner BYPASSRLS).
 *
 * ADR-284 compliant: follows the layer-RLS runner pattern exactly.
 */
export function createRlsPlanTreeStore(
  prisma: PlanTreePrismaClient & TransactionalPrismaLike,
  ctx: { tenantPackId: string; userId: string },
): PlanTreeStore {
  // Wrap $transaction to inject GUC before the store's queries.
  const rlsWrapped: PlanTreePrismaClient = {
    get planNode() { return prisma.planNode; },
    $transaction: async <T>(fn: (tx: PlanTreePrismaClient) => Promise<T>): Promise<T> => {
      return prisma.$transaction(async (tx) => {
        await applyLayerTenantGuc(tx as unknown as RawPrismaLike, ctx.tenantPackId);
        return fn(tx as unknown as PlanTreePrismaClient);
      });
    },
  };
  return new PrismaPlanTreeStore(rlsWrapped, ctx);
}
```

### Task 2: Update `server.ts` — use app role when `SUBSTRATE_APP_DATABASE_URL` is set

In `main()`, update the DB binding block. When `SUBSTRATE_APP_DATABASE_URL` is set, use
`createRlsPlanTreeStore` (RLS-enforced); otherwise fall back to the existing
`PrismaPlanTreeStore` with the owner connection (existing behavior, unchanged):

```typescript
import type { PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';

// Phase 7/8: when a substrate DB is configured, bind the canonical kernel.plan_node
// store. Phase 8 adds RLS isolation: if SUBSTRATE_APP_DATABASE_URL is set (app role,
// NOBYPASSRLS), wrap with GUC injection. Falls back to owner connection when absent.
const dbUrl = process.env['SUBSTRATE_DATABASE_URL'];
const appDbUrl = process.env['SUBSTRATE_APP_DATABASE_URL'];
const tenantPackId = process.env['FOUNDRY_TENANT_PACK_ID'] ?? '00000000-0000-4000-8000-000000000000';
const userId = process.env['FOUNDRY_USER_ID'] ?? '00000000-0000-4000-8000-000000000001';
let planTreeStore: PlanTreeStore | undefined;
if (dbUrl) {
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPlanTreeStore } = await import('@de-braighter/substrate-runtime');
  const activeUrl = appDbUrl ?? dbUrl;
  const prisma = new PrismaClient({ datasources: { db: { url: activeUrl } } });
  if (appDbUrl) {
    const { createRlsPlanTreeStore } = await import('./rls-plan-tree-store.js');
    planTreeStore = createRlsPlanTreeStore(prisma as unknown as Parameters<typeof createRlsPlanTreeStore>[0], { tenantPackId, userId });
  } else {
    planTreeStore = new PrismaPlanTreeStore(
      prisma as unknown as ConstructorParameters<typeof PrismaPlanTreeStore>[0],
      { tenantPackId, userId },
    );
  }
}
```

Note: the `createRlsPlanTreeStore` import is also lazy (inside `if (dbUrl)`) so NestJS/Prisma
still only load when DB is configured.

### Task 3: Add tests for `rls-plan-tree-store.ts`

Create `src/mcp/rls-plan-tree-store.spec.ts`:

```typescript
// Tests for the RLS GUC wrapper — verifies applyLayerTenantGuc is called inside the
// same transaction as the store's queries.
import { describe, expect, it, vi } from 'vitest';
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';
import { createRlsPlanTreeStore } from './rls-plan-tree-store.js';

function makeFakePrisma(tenantPackId: string) {
  const sqlCalls: string[] = [];
  const createManyCalls: unknown[] = [];
  const deletedTrees: string[] = [];
  return {
    planNode: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async (args: { where: { treeRootId: string } }) => {
        deletedTrees.push(args.where.treeRootId);
      }),
      createMany: vi.fn(async (args: { data: unknown[] }) => {
        createManyCalls.push(args.data);
      }),
    },
    $executeRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
      sqlCalls.push(`${sql} [${values.join(',')}]`);
      return 0;
    }),
    $queryRawUnsafe: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      planNode: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async (args: { where: { treeRootId: string } }) => {
          deletedTrees.push(args.where.treeRootId);
        }),
        createMany: vi.fn(async (args: { data: unknown[] }) => {
          createManyCalls.push(args.data);
        }),
      },
      $executeRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
        sqlCalls.push(`${sql} [${values.join(',')}]`);
        return 0;
      }),
      $queryRawUnsafe: vi.fn(async () => []),
    })),
    _state: { sqlCalls, createManyCalls, deletedTrees },
  };
}

describe('createRlsPlanTreeStore', () => {
  it('sets app.tenant_pack_id GUC inside the transaction before queries', async () => {
    const TENANT = 'tenant-abc';
    const USER = 'user-xyz';
    const fakePrisma = makeFakePrisma(TENANT);
    const store = createRlsPlanTreeStore(fakePrisma as unknown as Parameters<typeof createRlsPlanTreeStore>[0], { tenantPackId: TENANT, userId: USER });

    const tree: PlanTree = {
      treeRootId: 'root-1',
      tenantPackId: TENANT,
      nodes: [{
        id: 'root-1',
        parentId: null,
        treeRootId: 'root-1',
        kind: 'knowledge.design-note',
        kindRef: 'knowledge.design-note',
        ordinal: 0,
        metadata: { title: 'Test', knowledge: { summary: 'test' } },
        childrenIds: [],
      }],
    };

    await store.save(tree);

    // The GUC SQL must have been called with our tenantPackId
    const guqCall = fakePrisma._state.sqlCalls.find(s => s.includes('set_config'));
    expect(guqCall).toBeDefined();
    expect(guqCall).toContain(TENANT);
  });

  it('returns a PlanTreeStore with load/save/applyEdit', () => {
    const TENANT = 'tenant-test';
    const fakePrisma = makeFakePrisma(TENANT);
    const store = createRlsPlanTreeStore(fakePrisma as unknown as Parameters<typeof createRlsPlanTreeStore>[0], { tenantPackId: TENANT, userId: 'user-1' });
    expect(typeof store.load).toBe('function');
    expect(typeof store.save).toBe('function');
    expect(typeof store.applyEdit).toBe('function');
  });
});
```

### Task 4: typecheck + tests + commit + PR

Run `npm run typecheck` (must be clean) and `npm run test` (all existing tests still pass).

```bash
git add src/mcp/rls-plan-tree-store.ts src/mcp/rls-plan-tree-store.spec.ts src/mcp/server.ts
git commit -m "feat(phase8-item4): RLS isolation — wrap PrismaPlanTreeStore with GUC injection on app-role connection"
```

## Known limitations (document in PR)

- The GUC wrapper uses the Prisma transaction callback's handle, which is cast to `RawPrismaLike`. This is structurally safe (the real Prisma tx handle has `$executeRawUnsafe`), but not type-checked — a future Prisma major could change the tx interface.
- Without `SUBSTRATE_APP_DATABASE_URL`, foundry continues to use the owner connection (BYPASSRLS). This is the existing behavior and is acceptable for single-operator foundry deployments.
- The `kernel.plan_node` RLS policy must be `FORCE ROW LEVEL SECURITY` for the GUC to take effect on the app role. This is guaranteed by the substrate migration; foundry does not own or modify the policy.
