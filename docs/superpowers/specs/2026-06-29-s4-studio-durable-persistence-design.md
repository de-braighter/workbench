# S4 — Studio Durable Persistence Design

**Date:** 2026-06-29
**ADR reserved:** ADR-288 (pending)
**Repos affected:** `domains/foundry`, `domains/studio`
**Kernel-Untouched:** yes — zero diff to `layers/substrate` production files (ADR-176)

## Context

The studio stores system drafts (plan trees) in `InMemoryBuildPathDraftStore`, which loses all
work on page reload. S4 replaces the in-memory store with a durable adapter backed by the kernel
`kernel.plan_node` table, accessed through the foundry server over HTTP.

S4 is two combined workstreams:

- **Auth layer** — the studio becomes a hosted multi-user web app; each user's drafts are
  isolated by `tenantPackId` via PostgreSQL RLS.
- **Persistence layer** — plan trees survive restarts; users can manage multiple named systems.

## Constraints

- `PlanTreeStore` port (`@de-braighter/substrate-contracts`) is consumed as-is; not extended.
- `PrismaPlanTreeStore` in `layers/substrate-runtime` is not used (NestJS-coupled); a standalone
  `FoundryPrismaPlanTreeStore` replicates the same GUC discipline without NestJS.
- `SET LOCAL` (not bare `SET`) is mandatory for every GUC call — scopes the tenant context to
  the current transaction only, preventing cross-connection leakage in the Prisma pool.

## Architecture

```
Studio (Angular SPA)                  Foundry Server (Node.js → Express)
──────────────────────────────────    ──────────────────────────────────────
AuthService                      ──▶  POST /api/auth/register
  access token: memory                POST /api/auth/login
  refresh token: localStorage         POST /api/auth/refresh  (RTR)
                                      POST /api/auth/logout
AuthInterceptor                         EdDSA (Ed25519) JWT, 15-min access
  Bearer header on foundry requests     studio.accounts + studio.refresh_tokens
  silent refresh on 401
  redirect /login on second 401

FoundryDraftStoreAdapter         ──▶  GET    /api/drafts
  implements PlanTreeStore             GET    /api/drafts/:treeRootId
  uses HttpClient → interceptor        PUT    /api/drafts/:treeRootId
                                       POST   /api/drafts/:treeRootId/edits
                                       DELETE /api/drafts/:treeRootId
SystemEditorPage                          JWT → tenantPackId + userId → GUC
  inject(PLAN_TREE_STORE)                 FoundryPrismaPlanTreeStore
  (replaces: new InMemoryBuildPathDraftStore) PrismaClient → kernel.plan_node

SystemsPickerComponent (new)     ──▶  GET /api/drafts (list)
  new system → crypto.randomUUID()
  (replaces: hardcoded 'EP-01')
```

Existing SDLC endpoints (`/api/plan-tree`, `/api/catalog`, `/api/snapshot`, control endpoints)
are **unchanged** — they remain unprotected, bound to `127.0.0.1`, for local/founder use.

## Foundry Server: raw http → Express

The current `server.ts` uses a raw Node.js `http.createServer` with 9 manual
`if (req.method && req.url)` branches. Adding JWT middleware and 10 new routes inline is
untenable; the server is migrated to Express.

All existing handler logic moves into named functions — behaviour is identical. New structure:

```typescript
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '64kb' }));

app.use('/api/auth',   authRouter);               // public
app.use('/api/drafts', authenticate, draftsRouter); // JWT-protected

// Existing endpoints — unchanged behaviour, unprotected (local-only binding)
app.get('/api/snapshot',                   handleSnapshot);
app.get('/api/catalog',                    handleCatalog);
app.get('/api/plan-tree',                  handlePlanTree);
app.post('/api/reprioritize-product',      handleReprioritize);
app.post('/api/authorize-workflow-stage',  handleAuthorizeWorkflow);
app.post('/api/conduct-workflow',          handleConductWorkflow);
app.post('/api/dispatch',                  handleDispatch);
app.get('/api/dispatch/status',            handleDispatchStatus);
app.get('/',                               handleDashboard);

const server = http.createServer(app);
server.listen(PORT, '127.0.0.1');
```

## Auth Subsystem

### Postgres schema

New `studio` schema — separate Prisma schema file owned by `domains/foundry/prisma/schema.prisma`.
Does not own migrations for `kernel.*`.

```sql
CREATE SCHEMA IF NOT EXISTS studio;

CREATE TABLE studio.accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,          -- Argon2id
  tenant_pack_id  TEXT NOT NULL,          -- auto-generated UUID at registration (one pack per account)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE studio.refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES studio.accounts(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,              -- SHA-256 of the raw refresh token
  expires_at  TIMESTAMPTZ NOT NULL,       -- 30 days
  revoked_at  TIMESTAMPTZ,               -- null = active
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Key management

Ed25519 key pair generated once via `scripts/generate-keys.ts`, stored in env:

```
STUDIO_JWT_PRIVATE_KEY=<base64-encoded Ed25519 private key>
STUDIO_JWT_PUBLIC_KEY=<base64-encoded Ed25519 public key>
```

`jose` handles signing and verification.

### JWT claims

```json
{
  "sub":          "<account-uuid>",
  "tenantPackId": "<pack-uuid>",
  "email":        "user@example.com",
  "iat":          1234567890,
  "exp":          1234568790
}
```

Access token lifetime: 15 minutes. Refresh token lifetime: 30 days.

### Auth endpoints (`authRouter`)

| Method | Route | Behaviour |
|--------|-------|-----------|
| `POST` | `/api/auth/register` | email + password → Argon2id hash, insert `studio.accounts`, issue token pair |
| `POST` | `/api/auth/login` | verify password → issue token pair |
| `POST` | `/api/auth/refresh` | refresh token → revoke old row (RTR), insert new row, issue new token pair |
| `POST` | `/api/auth/logout` | mark `revoked_at`, clear client tokens |

Token pair response: `{ accessToken: string, refreshToken: string }`.

### `authenticate` middleware

Verifies EdDSA JWT using the public key. Rejects expired/invalid tokens with 401. Attaches
`req.user = { userId: string, tenantPackId: string }` for downstream handlers.

## FoundryPrismaPlanTreeStore

Location: `domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.ts`

Standalone (no NestJS). One instance created per request by the drafts router from `req.user`.

```typescript
export interface PlanTreeWriteContext {
  readonly tenantPackId: string;
  readonly userId: string;
}

export class FoundryPrismaPlanTreeStore implements PlanTreeStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ctx: PlanTreeWriteContext,
  ) {}

  async load(treeRootId: string): Promise<PlanTree | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.tenant_pack_id = ${this.ctx.tenantPackId}`;
      await tx.$executeRaw`SET LOCAL app.user_id = ${this.ctx.userId}`;
      const rows = await tx.plan_node.findMany({
        where: { tree_root_id: treeRootId },
        orderBy: { ordinal: 'asc' },
      });
      return rows.length ? rowsToPlanTree(rows) : null;
    });
  }

  async save(tree: PlanTree): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.tenant_pack_id = ${this.ctx.tenantPackId}`;
      await tx.$executeRaw`SET LOCAL app.user_id = ${this.ctx.userId}`;
      await tx.plan_node.deleteMany({ where: { tree_root_id: tree.treeRootId } });
      await tx.plan_node.createMany({ data: planTreeToRows(tree, this.ctx) });
    });
  }

  async applyEdit(treeRootId: string, edit: PlanTreeEdit): Promise<PlanTree> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.tenant_pack_id = ${this.ctx.tenantPackId}`;
      await tx.$executeRaw`SET LOCAL app.user_id = ${this.ctx.userId}`;
      const rows = await tx.plan_node.findMany({
        where: { tree_root_id: treeRootId },
        orderBy: { ordinal: 'asc' },
      });
      if (!rows.length) throw new Error(`no draft at treeRootId=${treeRootId}`);
      const current = rowsToPlanTree(rows);
      const next = applyEditToTree(current, edit, { onMissingTarget: 'noop' });
      await tx.plan_node.deleteMany({ where: { tree_root_id: treeRootId } });
      await tx.plan_node.createMany({ data: planTreeToRows(next, this.ctx) });
      return next;
    });
  }
}

function storeFor(req: AuthenticatedRequest, prisma: PrismaClient): FoundryPrismaPlanTreeStore {
  return new FoundryPrismaPlanTreeStore(prisma, {
    tenantPackId: req.user.tenantPackId,
    userId: req.user.userId,
  });
}
```

`rowsToPlanTree` and `planTreeToRows` are pure functions following the same column synthesis
rules as `PrismaPlanTreeStore` (depth computed, `metadata.__kindRef`, `childrenIds` from
`parent_id + ordinal`). Trees written by the foundry are readable by the kernel runtime.

`PrismaClient` is constructed once at server startup from `DATABASE_URL` and shared (connection
pool). The foundry's Prisma schema references `kernel.plan_node` (read + write) and `studio.*`
tables; it does not own `kernel.*` migrations.

## Draft API Endpoints

All routes mounted at `/api/drafts`, protected by `authenticate`.

| Method | Route | Behaviour |
|--------|-------|-----------|
| `GET` | `/api/drafts` | list root nodes for `tenantPackId`; returns `{ drafts: ListItem[] }` |
| `GET` | `/api/drafts/:treeRootId` | load one tree; returns `{ draft: PlanTree \| null }` |
| `PUT` | `/api/drafts/:treeRootId` | full upsert (delete-all + insert-all in transaction) |
| `POST` | `/api/drafts/:treeRootId/edits` | apply `PlanTreeEdit`; returns `{ draft: PlanTree }` |
| `DELETE` | `/api/drafts/:treeRootId` | delete all nodes for tree |

List item shape reads `metadata.systemName` from the root node (set by `seedNewSystemDraft()`):

```typescript
type ListItem = { treeRootId: string; name: string };
```

All handlers wrapped in `asyncHandler`; unhandled errors → 500 JSON response.
401 from `authenticate` middleware; null `draft` on GET signals "not found" to client.

## Studio Client

### `FoundryDraftStoreAdapter`

Location: `domains/studio/apps/studio-ui/src/app/build-path/core/foundry-draft-store.adapter.ts`

Uses `HttpClient` so `AuthInterceptor` handles token injection transparently:

```typescript
export class FoundryDraftStoreAdapter implements PlanTreeStore {
  private readonly http = inject(HttpClient);
  private readonly base = inject(FOUNDRY_BASE_URL);

  async load(treeRootId: string): Promise<PlanTree | null> {
    return firstValueFrom(
      this.http.get<{ draft: PlanTree | null }>(`${this.base}/api/drafts/${treeRootId}`)
        .pipe(map(r => r.draft), catchError(() => of(null)))
    );
  }

  async save(tree: PlanTree): Promise<void> {
    // Errors propagate — callers must handle write failures.
    await firstValueFrom(
      this.http.put(`${this.base}/api/drafts/${tree.treeRootId}`, tree)
    );
  }

  async applyEdit(treeRootId: string, edit: PlanTreeEdit): Promise<PlanTree> {
    // Errors propagate — callers must handle write failures.
    return firstValueFrom(
      this.http.post<{ draft: PlanTree }>(
        `${this.base}/api/drafts/${treeRootId}/edits`, edit
      ).pipe(map(r => r.draft))
    );
  }
}
```

### DI wiring (`app.config.ts`)

```typescript
// New providers:
{ provide: PLAN_TREE_STORE, useClass: FoundryDraftStoreAdapter },
{ provide: FOUNDRY_BASE_URL, useValue: environment.foundryBaseUrl },
provideHttpClient(withInterceptors([authInterceptor])),
```

`PLAN_TREE_STORE` is the existing symbol from `@de-braighter/substrate-contracts` —
no new token needed.

`SystemEditorPage` switches from direct instantiation to injection:

```typescript
// Before:
private readonly store = new InMemoryBuildPathDraftStore(seedNewSystemDraft());
// After:
private readonly store = inject(PLAN_TREE_STORE) as PlanTreeStore;
```

### `treeRootId` — UUID on creation

`seedNewSystemDraft()` drops the `'EP-01'` default; `treeRootId` becomes a required parameter:

```typescript
export function seedNewSystemDraft(treeRootId: string): BuildPathDraft { ... }
```

Called as `seedNewSystemDraft(crypto.randomUUID())` in `SystemsPickerComponent` on "New System".

### `AuthService`

- Access token stored in memory (tab lifetime only — not localStorage).
- Refresh token stored in `localStorage` (survives reload).
- On app init: if refresh token present → silent `/api/auth/refresh` to restore session.
- `login(email, password)`, `logout()`, `refreshAccessToken()`.

### `AuthInterceptor`

- Adds `Authorization: Bearer <accessToken>` to all requests to `FOUNDRY_BASE_URL`.
- On 401 → one silent `refreshAccessToken()` → retry.
- On second 401 → redirect to `/login`.

### `SystemsPickerComponent`

Replaces the current hardcoded single-system entry point. Backed by `GET /api/drafts`:

```
┌─────────────────────────────────────────┐
│  Your Systems                  [+ New]  │
├─────────────────────────────────────────┤
│  ▸ Exercise App      [Edit]  [Delete]   │
│  ▸ Nutrition Tracker [Edit]  [Delete]   │
└─────────────────────────────────────────┘
```

- **New System** → `crypto.randomUUID()` → `store.save(seedNewSystemDraft(id))` → navigate to editor.
- **Edit** → navigate to editor with the selected `treeRootId`.
- **Delete** → `DELETE /api/drafts/:treeRootId` → refresh list.

## Testing

### Unit (vitest)

| Subject | Assertions |
|---------|-----------|
| `FoundryPrismaPlanTreeStore` | `SET LOCAL` called first in every transaction; `applyEdit` rejects on missing tree |
| `rowsToPlanTree` / `planTreeToRows` | Round-trip deep equality; depth computation; `childrenIds` derivation |
| `AuthService` | Token storage; silent restore on init; both tokens cleared on logout |
| `AuthInterceptor` | Bearer header on foundry requests only; retry on 401; redirect on second 401 |
| `FoundryDraftStoreAdapter` | HttpTestingController: correct endpoints, method, body; `load` returns null on error |
| `seedNewSystemDraft` | Required `treeRootId`; UUID is both `treeRootId` and root node `id` |

### Integration (vitest + Testcontainers Postgres)

| Subject | Assertions |
|---------|-----------|
| `FoundryPrismaPlanTreeStore` | `save` → `load` round-trip; `applyEdit` persists; **cross-tenant isolation** (two accounts, same `treeRootId`, neither sees the other's data) |
| Auth endpoints | Register → login → refresh (RTR: old token revoked) → logout (token unusable) |
| Draft endpoints | Full CRUD; 401 on missing/invalid JWT; tenant isolation (account A cannot load account B's draft) |

### E2E (Playwright) — acceptance gate

1. Register → login → systems picker (empty)
2. "New System" → editor with seeded tree
3. Edit a node label
4. Reload → editor reopens with the edit persisted
5. Back to picker → system appears in list
6. Delete → system gone from list

The E2E directly tests the "survive reload" requirement that `InMemoryBuildPathDraftStore` fails.

## Kernel-Untouched Checklist

| File path | Changed? |
|-----------|---------|
| `layers/substrate/libs/substrate-contracts/**` | No |
| `layers/substrate/libs/substrate-runtime/**` | No |
| `layers/charter-runtime/**` | No |
| `domains/foundry/src/**` | Yes — Express migration, auth subsystem, draft endpoints, `FoundryPrismaPlanTreeStore` |
| `domains/studio/apps/studio-ui/src/**` | Yes — auth client, `FoundryDraftStoreAdapter`, DI wiring, `SystemsPickerComponent`, `treeRootId` fix |

ADR-176 satisfied.
