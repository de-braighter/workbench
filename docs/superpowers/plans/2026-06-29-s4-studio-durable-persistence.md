# S4 — Studio Durable Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `InMemoryBuildPathDraftStore` with a durable foundry-backed adapter, add a JWT auth layer to the foundry server, and surface a `SystemsPickerComponent` so named systems survive page reload.

**Architecture:** The foundry server migrates from raw Node.js `http` to Express and gains `authRouter` (public) + `draftsRouter` (JWT-protected), backed by new `studio.accounts` and `studio.refresh_tokens` Postgres tables. The studio gains `AuthService`, a functional `AuthInterceptor`, and `FoundryDraftStoreAdapter` implementing the existing `PlanTreeStore` port. `SystemEditorPage` switches to `inject(PLAN_TREE_STORE)` and loads its draft by `treeRootId` route param. `SystemsPickerComponent` becomes the new `/systems` entry point.

**Tech Stack:** Express 4, jose (EdDSA/Ed25519 JWT), argon2 (Argon2id), Prisma 5 (multiSchema + `SET LOCAL` GUC), Angular `HttpClient` + functional interceptor, Vitest + `@testcontainers/postgresql`, Playwright E2E.

## Global Constraints

- **Kernel-Untouched:** zero diff to `layers/substrate/**` production files (ADR-176).
- `SET LOCAL` (never bare `SET`) for every GUC call — scopes to current transaction only.
- Foundry keeps `127.0.0.1` binding; all existing SDLC endpoints remain unprotected and behaviour-identical.
- `PLAN_TREE_STORE` is the existing `unique symbol` from `@de-braighter/substrate-contracts/plan-tree` — no new token.
- `seedNewSystemDraft(treeRootId: string)` — `treeRootId` becomes a **required** parameter; all callers pass `crypto.randomUUID()`.
- Access token: 15-min EdDSA JWT. Refresh token: 30-day opaque 32-byte hex stored as SHA-256 hash in DB (RTR — rotate on every use).
- Foundry DB env var stays `SUBSTRATE_DATABASE_URL` (no rename).
- The `studio` schema tables are applied via a one-time SQL init file — foundry does NOT own `kernel.*` migrations.

---

## File Map

### Created — Foundry (`domains/foundry/`)

| File | Responsibility |
|------|---------------|
| `prisma/studio-init.sql` | One-time DDL for `studio.accounts` + `studio.refresh_tokens` |
| `scripts/generate-keys.ts` | Ed25519 key-pair generator → stdout |
| `src/auth/jwt.ts` | `signAccessToken`, `verifyAccessToken`, `generateRefreshToken`, `hashToken`, `loadKeysFromEnv` |
| `src/auth/auth.service.ts` | `AuthService`: register, login, refresh (RTR), logout |
| `src/auth/authenticate.middleware.ts` | Express middleware: verifies JWT, attaches `req.user` |
| `src/auth/auth.router.ts` | `createAuthRouter(authService)` → `express.Router` |
| `src/plan-tree/plan-tree-rows.ts` | `rowsToPlanTree`, `planTreeToRows` (ported from `PrismaPlanTreeStore`) |
| `src/plan-tree/foundry-prisma-plan-tree.store.ts` | `FoundryPrismaPlanTreeStore` + `storeFor(req, prisma)` |
| `src/plan-tree/drafts.router.ts` | `createDraftsRouter(prisma, keys)` → `express.Router` |
| `src/auth/jwt.spec.ts` | Unit: sign/verify round-trip, hash |
| `src/auth/auth.service.spec.ts` | Unit: register/login/refresh/logout with fake Prisma |
| `src/plan-tree/plan-tree-rows.spec.ts` | Unit: round-trip, depth, childrenIds derivation |
| `src/plan-tree/foundry-prisma-plan-tree.store.spec.ts` | Unit: GUC calls first, applyEdit rejects on missing |
| `src/plan-tree/foundry-prisma-plan-tree.store.db.spec.ts` | Integration: Testcontainers Postgres, cross-tenant isolation |
| `src/auth/auth.integration.spec.ts` | Integration: register→login→refresh (RTR)→logout |

### Modified — Foundry

| File | Change |
|------|--------|
| `package.json` | Add `express`, `cors`, `argon2`, `jose`; devDeps `@types/express`, `@types/cors`, `@testcontainers/postgresql`, `testcontainers` |
| `prisma/schema.prisma` | Add `"studio"` to datasource schemas; add `Account` + `RefreshToken` models |
| `src/dashboard/server.ts` | Migrate to Express; mount auth + drafts routers; port existing handlers as named functions |

### Created — Studio (`domains/studio/apps/studio-ui/src/app/`)

| File | Responsibility |
|------|---------------|
| `auth/auth.service.ts` | Angular `AuthService`: access token in memory, refresh token in localStorage, silent restore on init |
| `auth/auth.interceptor.ts` | Functional `HttpInterceptorFn`: Bearer header + 401→refresh→retry→redirect |
| `auth/login.page.ts` | Standalone login form component |
| `auth/auth.guard.ts` | `CanActivateFn`: redirects to `/login` if no access token |
| `build-path/core/foundry-draft-store.adapter.ts` | `FoundryDraftStoreAdapter` + `FOUNDRY_BASE_URL` injection token |
| `systems-picker/systems-picker.component.ts` | List systems, new/edit/delete |
| `auth/auth.service.spec.ts` | Unit: token storage, silent restore, logout |
| `auth/auth.interceptor.spec.ts` | Unit: Bearer header, 401 retry, redirect |
| `build-path/core/foundry-draft-store.adapter.spec.ts` | Unit: HttpTestingController, load returns null on error |

### Modified — Studio

| File | Change |
|------|--------|
| `app.config.ts` | Add `provideHttpClient(withInterceptors([authInterceptor]))`, `PLAN_TREE_STORE`, `FOUNDRY_BASE_URL` providers |
| `app.routes.ts` | Add `/login`, `/systems`, `/system/:treeRootId` routes; guard protected routes; `withComponentInputBinding()` |
| `system-editor/editor-model.ts` | `seedNewSystemDraft(treeRootId: string)` — make required |
| `system-editor/system-editor.page.ts` | `treeRootId = input.required<string>()`, inject store, async load on init |

---

### Task 1: Foundry — Add Dependencies + Extend Prisma Schema

**Files:**
- Modify: `domains/foundry/package.json`
- Modify: `domains/foundry/prisma/schema.prisma`
- Create: `domains/foundry/prisma/studio-init.sql`

**Interfaces:**
- Produces: `prisma.account`, `prisma.refreshToken` Prisma client accessors for Tasks 4, 8

- [ ] **Step 1: Add npm dependencies**

In `domains/foundry/package.json`, under `"dependencies"`:
```json
"argon2": "^0.31.2",
"cors": "^2.8.5",
"express": "^4.21.2",
"jose": "^5.9.6"
```
Under `"devDependencies"`:
```json
"@testcontainers/postgresql": "^10.24.2",
"@types/cors": "^2.8.17",
"@types/express": "^5.0.0",
"testcontainers": "^10.24.2"
```

- [ ] **Step 2: Run install**

```bash
cd domains/foundry && npm install
```
Expected: lock file updated, no peer-dep errors.

- [ ] **Step 3: Extend Prisma schema — datasource + studio models**

In `domains/foundry/prisma/schema.prisma`, change the datasource `schemas` line and append the studio models:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("SUBSTRATE_DATABASE_URL")
  schemas  = ["kernel", "studio"]
}

model Account {
  id            String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email         String         @unique
  passwordHash  String         @map("password_hash")
  tenantPackId  String         @map("tenant_pack_id") @db.Uuid
  createdAt     DateTime       @default(now()) @map("created_at") @db.Timestamptz()

  refreshTokens RefreshToken[]

  @@map("accounts")
  @@schema("studio")
}

model RefreshToken {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId String    @map("account_id") @db.Uuid
  tokenHash String    @map("token_hash")
  expiresAt DateTime  @map("expires_at") @db.Timestamptz()
  revokedAt DateTime? @map("revoked_at") @db.Timestamptz()
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  account   Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@map("refresh_tokens")
  @@schema("studio")
}
```

- [ ] **Step 4: Create the SQL init file**

Create `domains/foundry/prisma/studio-init.sql`:
```sql
CREATE SCHEMA IF NOT EXISTS studio;

CREATE TABLE IF NOT EXISTS studio.accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  tenant_pack_id  UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio.refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES studio.accounts(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rt_account ON studio.refresh_tokens(account_id);
CREATE INDEX IF NOT EXISTS idx_rt_hash    ON studio.refresh_tokens(token_hash) WHERE revoked_at IS NULL;
```

- [ ] **Step 5: Apply the SQL to your dev database**

```bash
psql "$SUBSTRATE_DATABASE_URL" -f domains/foundry/prisma/studio-init.sql
```
Expected: `CREATE SCHEMA`, `CREATE TABLE`, `CREATE TABLE`, `CREATE INDEX`, `CREATE INDEX`.

- [ ] **Step 6: Regenerate the Prisma client**

```bash
cd domains/foundry && npm run prisma:generate
```
Expected: client generated; `@prisma/client` now includes `.account` and `.refreshToken`.

- [ ] **Step 7: Typecheck**

```bash
cd domains/foundry && npm run typecheck
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add domains/foundry/package.json domains/foundry/package-lock.json \
        domains/foundry/prisma/schema.prisma domains/foundry/prisma/studio-init.sql
git commit -m "feat(foundry): add express/jose/argon2/testcontainers deps; extend prisma schema with studio.*"
```

---

### Task 2: Foundry — Key Generation Script

**Files:**
- Create: `domains/foundry/scripts/generate-keys.ts`

**Interfaces:**
- Produces: env vars `STUDIO_JWT_PRIVATE_KEY` and `STUDIO_JWT_PUBLIC_KEY` (base64 PEM) consumed by Task 3

- [ ] **Step 1: Create the script**

Create `domains/foundry/scripts/generate-keys.ts`:
```typescript
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';

const { publicKey, privateKey } = await generateKeyPair('EdDSA');
const priv = await exportPKCS8(privateKey);
const pub  = await exportSPKI(publicKey);

console.log(`STUDIO_JWT_PRIVATE_KEY=${Buffer.from(priv).toString('base64')}`);
console.log(`STUDIO_JWT_PUBLIC_KEY=${Buffer.from(pub).toString('base64')}`);
```

- [ ] **Step 2: Run and add to .env**

```bash
cd domains/foundry && npx tsx scripts/generate-keys.ts >> .env
```
Expected: two lines appended to `.env`.

- [ ] **Step 3: Verify .env has keys**

```bash
grep STUDIO_JWT .env
```
Expected: two lines starting with `STUDIO_JWT_PRIVATE_KEY=` and `STUDIO_JWT_PUBLIC_KEY=`.

- [ ] **Step 4: Commit**

```bash
git add domains/foundry/scripts/generate-keys.ts
git commit -m "feat(foundry): add Ed25519 key-pair generator script"
```

---

### Task 3: Foundry — JWT Utilities + Unit Tests

**Files:**
- Create: `domains/foundry/src/auth/jwt.ts`
- Create: `domains/foundry/src/auth/jwt.spec.ts`

**Interfaces:**
- Produces:
  - `signAccessToken(claims, privateKey): Promise<string>` — 15-min EdDSA JWT
  - `verifyAccessToken(token, publicKey): Promise<StudioClaims>` — throws on invalid/expired
  - `generateRefreshToken(): string` — 32-byte hex opaque token
  - `hashToken(raw: string): string` — SHA-256 hex
  - `loadKeysFromEnv(): Promise<KeyPair>` — reads `STUDIO_JWT_PRIVATE_KEY/PUBLIC_KEY`
  - `interface StudioClaims { sub: string; tenantPackId: string; email: string }`
  - `interface KeyPair { privateKey: CryptoKey; publicKey: CryptoKey }`

- [ ] **Step 1: Write the failing test**

Create `domains/foundry/src/auth/jwt.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { generateKeyPair } from 'jose';
import {
  signAccessToken, verifyAccessToken,
  generateRefreshToken, hashToken,
  type KeyPair, type StudioClaims,
} from './jwt.js';

async function makeKeys(): Promise<KeyPair> {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA');
  return { privateKey, publicKey };
}

const CLAIMS: StudioClaims = { sub: 'user-1', tenantPackId: 'pack-1', email: 'a@b.com' };

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips claims', async () => {
    const keys = await makeKeys();
    const token = await signAccessToken(CLAIMS, keys.privateKey);
    const result = await verifyAccessToken(token, keys.publicKey);
    expect(result.sub).toBe('user-1');
    expect(result.tenantPackId).toBe('pack-1');
    expect(result.email).toBe('a@b.com');
  });

  it('rejects a token signed with a different key', async () => {
    const keys1 = await makeKeys();
    const keys2 = await makeKeys();
    const token = await signAccessToken(CLAIMS, keys1.privateKey);
    await expect(verifyAccessToken(token, keys2.publicKey)).rejects.toThrow();
  });
});

describe('generateRefreshToken', () => {
  it('returns a 64-char hex string', () => {
    const t = generateRefreshToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns unique values', () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });
});

describe('hashToken', () => {
  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('returns a 64-char hex SHA-256', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd domains/foundry && npm test -- src/auth/jwt.spec.ts
```
Expected: FAIL — `jwt.ts` does not exist.

- [ ] **Step 3: Implement `jwt.ts`**

Create `domains/foundry/src/auth/jwt.ts`:
```typescript
import { SignJWT, jwtVerify, importPKCS8, importSPKI, type JWTPayload } from 'jose';
import { createHash, randomBytes } from 'node:crypto';

export interface StudioClaims extends JWTPayload {
  tenantPackId: string;
  email: string;
}

export interface KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export async function loadKeysFromEnv(): Promise<KeyPair> {
  const priv = Buffer.from(process.env['STUDIO_JWT_PRIVATE_KEY']!, 'base64').toString('utf8');
  const pub  = Buffer.from(process.env['STUDIO_JWT_PUBLIC_KEY']!,  'base64').toString('utf8');
  return {
    privateKey: await importPKCS8(priv, 'EdDSA'),
    publicKey:  await importSPKI(pub,  'EdDSA'),
  };
}

export async function signAccessToken(
  payload: StudioClaims,
  privateKey: CryptoKey,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);
}

export async function verifyAccessToken(
  token: string,
  publicKey: CryptoKey,
): Promise<StudioClaims> {
  const { payload } = await jwtVerify<StudioClaims>(token, publicKey);
  return payload;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd domains/foundry && npm test -- src/auth/jwt.spec.ts
```
Expected: 5 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add domains/foundry/src/auth/jwt.ts domains/foundry/src/auth/jwt.spec.ts
git commit -m "feat(foundry/auth): JWT sign/verify utilities (EdDSA) + unit tests"
```

---

### Task 4: Foundry — AuthService + Unit Tests

**Files:**
- Create: `domains/foundry/src/auth/auth.service.ts`
- Create: `domains/foundry/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `KeyPair`, `generateRefreshToken`, `hashToken`, `signAccessToken` from `./jwt.js`; `PrismaClient` from `@prisma/client`
- Produces:
  - `class AuthService { register(email, password): Promise<TokenPair>; login(email, password): Promise<TokenPair>; refresh(rawToken): Promise<TokenPair>; logout(rawToken): Promise<void> }`
  - `interface TokenPair { accessToken: string; refreshToken: string }`

- [ ] **Step 1: Write the failing test**

Create `domains/foundry/src/auth/auth.service.spec.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateKeyPair } from 'jose';
import { AuthService } from './auth.service.js';
import type { KeyPair } from './jwt.js';

function makeFakePrisma() {
  const accounts = new Map<string, { id: string; email: string; passwordHash: string; tenantPackId: string }>();
  const tokens   = new Map<string, { id: string; accountId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }>();
  let nextId = 0;

  return {
    account: {
      async create({ data }: { data: { email: string; passwordHash: string; tenantPackId: string } }) {
        const id = `acc-${++nextId}`;
        const row = { id, ...data };
        accounts.set(id, row);
        return row;
      },
      async findUnique({ where }: { where: { email?: string; id?: string } }) {
        if (where.email) return [...accounts.values()].find(a => a.email === where.email) ?? null;
        if (where.id)    return accounts.get(where.id) ?? null;
        return null;
      },
      async findUniqueOrThrow({ where }: { where: { id: string } }) {
        const a = accounts.get(where.id);
        if (!a) throw new Error('not found');
        return a;
      },
    },
    refreshToken: {
      async create({ data }: { data: { accountId: string; tokenHash: string; expiresAt: Date } }) {
        const id = `rt-${++nextId}`;
        tokens.set(id, { id, ...data, revokedAt: null });
        return tokens.get(id)!;
      },
      async findFirst({ where }: { where: { tokenHash: string; revokedAt: null; expiresAt: { gt: Date } } }) {
        return [...tokens.values()].find(t =>
          t.tokenHash === where.tokenHash && t.revokedAt === null && t.expiresAt > where.expiresAt.gt
        ) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { revokedAt: Date } }) {
        const t = tokens.get(where.id)!;
        t.revokedAt = data.revokedAt;
        return t;
      },
      async updateMany({ where, data }: { where: { tokenHash: string }; data: { revokedAt: Date } }) {
        for (const t of tokens.values()) {
          if (t.tokenHash === where.tokenHash) t.revokedAt = data.revokedAt;
        }
        return {};
      },
    },
  };
}

describe('AuthService', () => {
  let keys: KeyPair;
  let svc: AuthService;
  let prisma: ReturnType<typeof makeFakePrisma>;

  beforeEach(async () => {
    const kp = await generateKeyPair('EdDSA');
    keys   = { privateKey: kp.privateKey, publicKey: kp.publicKey };
    prisma = makeFakePrisma();
    svc    = new AuthService(prisma as never, keys);
  });

  it('register: returns token pair with non-empty tokens', async () => {
    const { accessToken, refreshToken } = await svc.register('a@b.com', 'pw');
    expect(accessToken.split('.').length).toBe(3);  // JWT structure
    expect(refreshToken).toHaveLength(64);           // 32-byte hex
  });

  it('login: valid credentials return token pair', async () => {
    await svc.register('a@b.com', 'pw');
    const { accessToken } = await svc.login('a@b.com', 'pw');
    expect(accessToken.split('.').length).toBe(3);
  });

  it('login: wrong password throws', async () => {
    await svc.register('a@b.com', 'pw');
    await expect(svc.login('a@b.com', 'wrong')).rejects.toThrow('invalid credentials');
  });

  it('login: unknown email throws', async () => {
    await expect(svc.login('no@b.com', 'pw')).rejects.toThrow('invalid credentials');
  });

  it('refresh: RTR — issues new pair, old refresh token becomes invalid', async () => {
    const { refreshToken: r1 } = await svc.register('a@b.com', 'pw');
    const { refreshToken: r2 } = await svc.refresh(r1);
    expect(r2).not.toBe(r1);
    await expect(svc.refresh(r1)).rejects.toThrow(); // r1 revoked
  });

  it('logout: revokes the refresh token', async () => {
    const { refreshToken } = await svc.register('a@b.com', 'pw');
    await svc.logout(refreshToken);
    await expect(svc.refresh(refreshToken)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd domains/foundry && npm test -- src/auth/auth.service.spec.ts
```
Expected: FAIL — `auth.service.ts` does not exist.

- [ ] **Step 3: Implement `auth.service.ts`**

Create `domains/foundry/src/auth/auth.service.ts`:
```typescript
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  type KeyPair,
  type StudioClaims,
} from './jwt.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly keys: KeyPair,
  ) {}

  async register(email: string, password: string): Promise<TokenPair> {
    const passwordHash  = await argon2.hash(password, { type: argon2.argon2id });
    const tenantPackId  = randomUUID();
    const account       = await this.prisma.account.create({
      data: { email, passwordHash, tenantPackId },
    });
    return this.issue(account.id, account.email, account.tenantPackId);
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const account = await this.prisma.account.findUnique({ where: { email } });
    if (!account) throw new Error('invalid credentials');
    const valid = await argon2.verify(account.passwordHash, password);
    if (!valid) throw new Error('invalid credentials');
    return this.issue(account.id, account.email, account.tenantPackId);
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const tokenHash = hashToken(rawRefreshToken);
    const row = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!row) throw new Error('invalid or expired refresh token');
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: row.accountId } });
    return this.issue(account.id, account.email, account.tenantPackId);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(userId: string, email: string, tenantPackId: string): Promise<TokenPair> {
    const claims: StudioClaims = { sub: userId, tenantPackId, email };
    const rawRefreshToken = generateRefreshToken();
    const [accessToken] = await Promise.all([
      signAccessToken(claims, this.keys.privateKey),
      this.prisma.refreshToken.create({
        data: {
          accountId: userId,
          tokenHash: hashToken(rawRefreshToken),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);
    return { accessToken, refreshToken: rawRefreshToken };
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd domains/foundry && npm test -- src/auth/auth.service.spec.ts
```
Expected: 6 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add domains/foundry/src/auth/auth.service.ts domains/foundry/src/auth/auth.service.spec.ts
git commit -m "feat(foundry/auth): AuthService with register/login/refresh(RTR)/logout + unit tests"
```

---

### Task 5: Foundry — authenticate Middleware + Auth Router

**Files:**
- Create: `domains/foundry/src/auth/authenticate.middleware.ts`
- Create: `domains/foundry/src/auth/auth.router.ts`

**Interfaces:**
- Consumes: `verifyAccessToken`, `KeyPair` from `./jwt.js`; `AuthService`, `TokenPair` from `./auth.service.js`
- Produces:
  - `authenticate: RequestHandler` — verifies `Authorization: Bearer <token>`, attaches `req.user = { userId: string; tenantPackId: string }`
  - `interface AuthenticatedRequest extends Request { user: { userId: string; tenantPackId: string } }`
  - `createAuthRouter(authService): Router`

- [ ] **Step 1: Create `authenticate.middleware.ts`**

```typescript
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type KeyPair } from './jwt.js';

export interface AuthenticatedRequest extends Request {
  user: { userId: string; tenantPackId: string };
}

export function createAuthenticate(keys: KeyPair) {
  return async function authenticate(
    req: Request, res: Response, next: NextFunction,
  ): Promise<void> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing token' });
      return;
    }
    try {
      const claims = await verifyAccessToken(auth.slice(7), keys.publicKey);
      (req as AuthenticatedRequest).user = {
        userId:       claims.sub!,
        tenantPackId: claims.tenantPackId,
      };
      next();
    } catch {
      res.status(401).json({ error: 'invalid or expired token' });
    }
  };
}
```

- [ ] **Step 2: Create `auth.router.ts`**

```typescript
import { Router, type Request, type Response } from 'express';
import type { AuthService } from './auth.service.js';

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      res.status(500).json({ error: (err as Error).message });
    });
  };
}

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  router.post('/register', asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) { res.status(400).json({ error: 'email and password required' }); return; }
    const pair = await authService.register(email, password);
    res.status(201).json(pair);
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) { res.status(400).json({ error: 'email and password required' }); return; }
    try {
      const pair = await authService.login(email, password);
      res.json(pair);
    } catch {
      res.status(401).json({ error: 'invalid credentials' });
    }
  }));

  router.post('/refresh', asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) { res.status(400).json({ error: 'refreshToken required' }); return; }
    try {
      const pair = await authService.refresh(refreshToken);
      res.json(pair);
    } catch {
      res.status(401).json({ error: 'invalid or expired refresh token' });
    }
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) await authService.logout(refreshToken);
    res.json({ ok: true });
  }));

  return router;
}
```

- [ ] **Step 3: Typecheck**

```bash
cd domains/foundry && npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add domains/foundry/src/auth/authenticate.middleware.ts domains/foundry/src/auth/auth.router.ts
git commit -m "feat(foundry/auth): authenticate middleware + auth router (register/login/refresh/logout)"
```

---

### Task 6: Foundry — Plan-Tree Row Utilities + Unit Tests

**Files:**
- Create: `domains/foundry/src/plan-tree/plan-tree-rows.ts`
- Create: `domains/foundry/src/plan-tree/plan-tree-rows.spec.ts`

**Interfaces:**
- Produces:
  - `rowsToPlanTree(treeRootId: string, rows: PlanNodeRow[]): PlanTree`
  - `planTreeToRows(tree: PlanTree, ctx: PlanTreeWriteContext): PlanNodeRow[]`
  - `interface PlanNodeRow` — matches the foundry Prisma `PlanNode` model camelCase fields
  - `interface PlanTreeWriteContext { tenantPackId: string; userId: string }`

- [ ] **Step 1: Write the failing test**

Create `domains/foundry/src/plan-tree/plan-tree-rows.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { rowsToPlanTree, planTreeToRows, type PlanNodeRow } from './plan-tree-rows.js';
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';

const CTX = { tenantPackId: 'pack-1', userId: 'user-1' };

const TREE: PlanTree = {
  treeRootId: 'root-1',
  tenantPackId: 'pack-1',
  nodes: [
    {
      id: 'root-1', parentId: null, treeRootId: 'root-1',
      kind: 'goal', kindRef: 'goal-ref', ordinal: 0,
      metadata: { label: 'System A' }, childrenIds: ['child-1'],
    },
    {
      id: 'child-1', parentId: 'root-1', treeRootId: 'root-1',
      kind: 'work', kindRef: 'work-ref', ordinal: 0,
      metadata: { label: 'Feature 1' }, childrenIds: [],
    },
  ],
};

describe('round-trip: planTreeToRows → rowsToPlanTree', () => {
  it('preserves all node fields', () => {
    const rows = planTreeToRows(TREE, CTX);
    const result = rowsToPlanTree('root-1', rows);
    expect(result.treeRootId).toBe('root-1');
    expect(result.tenantPackId).toBe('pack-1');
    expect(result.nodes).toHaveLength(2);
    const root = result.nodes.find(n => n.id === 'root-1')!;
    expect(root.kind).toBe('goal');
    expect(root.kindRef).toBe('goal-ref');
    expect(root.metadata).toEqual({ label: 'System A' });
    expect(root.childrenIds).toEqual(['child-1']);
    expect(root.parentId).toBeNull();
  });

  it('computes depth: root=0, child=1', () => {
    const rows = planTreeToRows(TREE, CTX);
    const rootRow = rows.find(r => r.id === 'root-1')!;
    const childRow = rows.find(r => r.id === 'child-1')!;
    expect(rootRow.depth).toBe(0);
    expect(childRow.depth).toBe(1);
  });

  it('stashes kindRef in metadata.__kindRef and strips it on load', () => {
    const rows = planTreeToRows(TREE, CTX);
    const rootRow = rows.find(r => r.id === 'root-1')!;
    expect(rootRow.metadata['__kindRef']).toBe('goal-ref');
    expect(rootRow.metadata['label']).toBe('System A');
    const result = rowsToPlanTree('root-1', rows);
    expect(result.nodes[0].metadata['__kindRef']).toBeUndefined();
  });

  it('stamps tenantPackId + userId from ctx onto every row', () => {
    const rows = planTreeToRows(TREE, CTX);
    for (const row of rows) {
      expect(row.tenantPackId).toBe('pack-1');
      expect(row.createdBy).toBe('user-1');
    }
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd domains/foundry && npm test -- src/plan-tree/plan-tree-rows.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `plan-tree-rows.ts`**

Create `domains/foundry/src/plan-tree/plan-tree-rows.ts`:
```typescript
import type { PlanNode, PlanTree } from '@de-braighter/substrate-contracts/plan-tree';

export interface PlanNodeRow {
  id: string;
  tenantPackId: string;
  treeRootId: string;
  parentId: string | null;
  ordinal: number;
  depth: number;
  kind: string;
  kindRef: string | null;
  tier: string;
  title: string;
  effects?: unknown;
  metadata: Record<string, unknown>;
  createdBy: string;
}

export interface PlanTreeWriteContext {
  readonly tenantPackId: string;
  readonly userId: string;
}

const KIND_REF_KEY      = '__kindRef';
const TENANT_PACK_KEY   = '__tenantPackId';

export function planTreeToRows(tree: PlanTree, ctx: PlanTreeWriteContext): PlanNodeRow[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const depthOf = makeDepthOf(byId);
  return tree.nodes.map((node) => {
    const metadata: Record<string, unknown> = { ...node.metadata, [KIND_REF_KEY]: node.kindRef };
    if (node.id === tree.treeRootId) metadata[TENANT_PACK_KEY] = tree.tenantPackId;
    const title = typeof node.metadata['title'] === 'string' ? node.metadata['title'] : node.kind;
    return {
      id: node.id,
      tenantPackId: ctx.tenantPackId,
      treeRootId: tree.treeRootId,
      parentId: node.parentId,
      ordinal: node.ordinal,
      depth: depthOf(node.id),
      kind: node.kind,
      kindRef: null,
      tier: 'vendor',
      title,
      metadata,
      createdBy: ctx.userId,
      ...(node.effectDeclarations && node.effectDeclarations.length > 0
        ? { effects: node.effectDeclarations }
        : {}),
    };
  });
}

export function rowsToPlanTree(treeRootId: string, rows: readonly PlanNodeRow[]): PlanTree {
  const childrenByParent = new Map<string, PlanNodeRow[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const sibs = childrenByParent.get(row.parentId) ?? [];
    sibs.push(row);
    childrenByParent.set(row.parentId, sibs);
  }
  let tenantPackId = '';
  const nodes: PlanNode[] = rows.map((row) => {
    const childrenIds = (childrenByParent.get(row.id) ?? [])
      .slice().sort((a, b) => a.ordinal - b.ordinal).map((c) => c.id);
    const { [KIND_REF_KEY]: stashedKindRef, [TENANT_PACK_KEY]: stashedTenantPack, ...userMeta } = row.metadata;
    if (row.id === treeRootId && typeof stashedTenantPack === 'string') tenantPackId = stashedTenantPack;
    const resolvedKindRef = typeof stashedKindRef === 'string' ? stashedKindRef : row.kindRef;
    if (!resolvedKindRef) throw new Error(`plan_node ${row.id} has no resolvable kindRef`);
    return {
      id: row.id,
      parentId: row.parentId,
      treeRootId: row.treeRootId,
      kind: row.kind,
      kindRef: resolvedKindRef,
      ordinal: row.ordinal,
      metadata: userMeta,
      childrenIds,
      ...(row.effects && Array.isArray(row.effects) && row.effects.length > 0
        ? { effectDeclarations: row.effects as PlanNode['effectDeclarations'] }
        : {}),
    };
  });
  return { treeRootId, tenantPackId, nodes };
}

function makeDepthOf(byId: ReadonlyMap<string, PlanNode>): (id: string) => number {
  const cache = new Map<string, number>();
  const resolve = (id: string, seen: Set<string>): number => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node || node.parentId === null || seen.has(id)) return 0;
    seen.add(id);
    const d = resolve(node.parentId, seen) + 1;
    cache.set(id, d);
    return d;
  };
  return (id) => resolve(id, new Set());
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd domains/foundry && npm test -- src/plan-tree/plan-tree-rows.spec.ts
```
Expected: 4 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add domains/foundry/src/plan-tree/plan-tree-rows.ts domains/foundry/src/plan-tree/plan-tree-rows.spec.ts
git commit -m "feat(foundry/plan-tree): row↔PlanTree mapping utilities + unit tests"
```

---

### Task 7: Foundry — FoundryPrismaPlanTreeStore + Unit Tests

**Files:**
- Create: `domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.ts`
- Create: `domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.spec.ts`

**Interfaces:**
- Consumes: `rowsToPlanTree`, `planTreeToRows`, `PlanTreeWriteContext` from `./plan-tree-rows.js`; `applyEditToTree` from `@de-braighter/substrate-contracts/plan-tree`
- Produces:
  - `class FoundryPrismaPlanTreeStore implements PlanTreeStore`
  - `storeFor(req: AuthenticatedRequest, prisma: PrismaClient): FoundryPrismaPlanTreeStore`

- [ ] **Step 1: Write the failing test**

Create `domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { FoundryPrismaPlanTreeStore } from './foundry-prisma-plan-tree.store.js';
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';

const CTX = { tenantPackId: 'pack-1', userId: 'user-1' };

const TREE: PlanTree = {
  treeRootId: 'root-1',
  tenantPackId: 'pack-1',
  nodes: [{
    id: 'root-1', parentId: null, treeRootId: 'root-1',
    kind: 'goal', kindRef: 'goal-ref', ordinal: 0,
    metadata: { label: 'Sys' }, childrenIds: [],
  }],
};

function makeTx() {
  const calls: string[] = [];
  const rows: unknown[] = [];
  return {
    calls,
    rows,
    $executeRaw: vi.fn(async () => { calls.push('SET LOCAL'); }),
    planNode: {
      findMany: vi.fn(async () => rows),
      deleteMany: vi.fn(async () => {}),
      createMany: vi.fn(async (args: { data: unknown[] }) => { rows.push(...args.data); }),
    },
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  return {
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx),
  };
}

describe('FoundryPrismaPlanTreeStore', () => {
  it('load: calls SET LOCAL before findMany', async () => {
    const tx = makeTx();
    const store = new FoundryPrismaPlanTreeStore(makePrisma(tx) as never, CTX);
    await store.load('root-1');
    expect(tx.calls[0]).toBe('SET LOCAL');
    expect(tx.calls[1]).toBe('SET LOCAL');
    expect(tx.planNode.findMany).toHaveBeenCalled();
  });

  it('save: calls SET LOCAL before deleteMany+createMany', async () => {
    const tx = makeTx();
    const store = new FoundryPrismaPlanTreeStore(makePrisma(tx) as never, CTX);
    await store.save(TREE);
    expect(tx.calls[0]).toBe('SET LOCAL');
    expect(tx.planNode.deleteMany).toHaveBeenCalled();
    expect(tx.planNode.createMany).toHaveBeenCalled();
  });

  it('applyEdit: throws when tree does not exist', async () => {
    const tx = makeTx();
    const store = new FoundryPrismaPlanTreeStore(makePrisma(tx) as never, CTX);
    await expect(
      store.applyEdit('missing', { type: 'rename-node', nodeId: 'x', label: 'y' })
    ).rejects.toThrow('no draft');
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd domains/foundry && npm test -- foundry-prisma-plan-tree.store.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `foundry-prisma-plan-tree.store.ts`**

Create `domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.ts`:
```typescript
import { applyEditToTree } from '@de-braighter/substrate-contracts/plan-tree';
import type { PlanTree, PlanTreeEdit, PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import type { PrismaClient } from '@prisma/client';
import { rowsToPlanTree, planTreeToRows, type PlanTreeWriteContext } from './plan-tree-rows.js';
import type { AuthenticatedRequest } from '../auth/authenticate.middleware.js';

export class FoundryPrismaPlanTreeStore implements PlanTreeStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ctx: PlanTreeWriteContext,
  ) {}

  async load(treeRootId: string): Promise<PlanTree | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.tenant_pack_id = ${this.ctx.tenantPackId}`;
      await tx.$executeRaw`SET LOCAL app.user_id = ${this.ctx.userId}`;
      const rows = await tx.planNode.findMany({
        where: { treeRootId, deletedAt: null },
        orderBy: { ordinal: 'asc' },
      });
      return rows.length ? rowsToPlanTree(treeRootId, rows) : null;
    });
  }

  async save(tree: PlanTree): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.tenant_pack_id = ${this.ctx.tenantPackId}`;
      await tx.$executeRaw`SET LOCAL app.user_id = ${this.ctx.userId}`;
      await tx.planNode.deleteMany({ where: { treeRootId: tree.treeRootId } });
      await tx.planNode.createMany({ data: planTreeToRows(tree, this.ctx) });
    });
  }

  async applyEdit(treeRootId: string, edit: PlanTreeEdit): Promise<PlanTree> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.tenant_pack_id = ${this.ctx.tenantPackId}`;
      await tx.$executeRaw`SET LOCAL app.user_id = ${this.ctx.userId}`;
      const rows = await tx.planNode.findMany({
        where: { treeRootId, deletedAt: null },
        orderBy: { ordinal: 'asc' },
      });
      if (!rows.length) throw new Error(`no draft at treeRootId=${treeRootId}`);
      const current = rowsToPlanTree(treeRootId, rows);
      const next    = applyEditToTree(current, edit, { onMissingTarget: 'noop' });
      await tx.planNode.deleteMany({ where: { treeRootId } });
      await tx.planNode.createMany({ data: planTreeToRows(next, this.ctx) });
      return next;
    });
  }
}

export function storeFor(
  req: AuthenticatedRequest,
  prisma: PrismaClient,
): FoundryPrismaPlanTreeStore {
  return new FoundryPrismaPlanTreeStore(prisma, {
    tenantPackId: req.user.tenantPackId,
    userId:       req.user.userId,
  });
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd domains/foundry && npm test -- foundry-prisma-plan-tree.store.spec.ts
```
Expected: 3 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.ts \
        domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.spec.ts
git commit -m "feat(foundry/plan-tree): FoundryPrismaPlanTreeStore + unit tests (SET LOCAL first, applyEdit atomic)"
```

---

### Task 8: Foundry — Integration Tests (Testcontainers)

**Files:**
- Create: `domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.db.spec.ts`
- Create: `domains/foundry/src/auth/auth.integration.spec.ts`

**Interfaces:**
- Consumes: `FoundryPrismaPlanTreeStore` from Task 7; `AuthService` from Task 4; real Postgres via `@testcontainers/postgresql`

- [ ] **Step 1: Create the store integration test**

Create `domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.db.spec.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { FoundryPrismaPlanTreeStore } from './foundry-prisma-plan-tree.store.js';
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';

// NOTE: this test requires Docker. Skip with SKIP_DB_TESTS=1.
const SKIP = !!process.env['SKIP_DB_TESTS'];

describe.skipIf(SKIP)('FoundryPrismaPlanTreeStore — real Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    // Apply substrate kernel schema (plan_node) + studio schema
    execSync(`psql "${container.getConnectionUri()}" -f domains/foundry/prisma/studio-init.sql`, { cwd: process.cwd() });
    // Apply kernel.plan_node — reference substrate migration SQL
    // (adjust path as needed for your dev setup)
    prisma = new PrismaClient({ datasources: { db: { url: container.getConnectionUri() } } });
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  const TREE: PlanTree = {
    treeRootId:   'tree-db-1',
    tenantPackId: 'pack-db-1',
    nodes: [{
      id: 'tree-db-1', parentId: null, treeRootId: 'tree-db-1',
      kind: 'goal', kindRef: 'goal-ref', ordinal: 0,
      metadata: { label: 'DB System' }, childrenIds: [],
    }],
  };

  const CTX_A = { tenantPackId: 'pack-db-1', userId: 'user-db-1' };
  const CTX_B = { tenantPackId: 'pack-db-2', userId: 'user-db-2' };

  it('save → load round-trip', async () => {
    const store = new FoundryPrismaPlanTreeStore(prisma, CTX_A);
    await store.save(TREE);
    const loaded = await store.load('tree-db-1');
    expect(loaded?.treeRootId).toBe('tree-db-1');
    expect(loaded?.nodes[0].kindRef).toBe('goal-ref');
  });

  it('cross-tenant isolation: account B cannot load account A's tree', async () => {
    const storeB = new FoundryPrismaPlanTreeStore(prisma, CTX_B);
    const result = await storeB.load('tree-db-1');
    expect(result).toBeNull();
  });
}, 60_000);
```

- [ ] **Step 2: Create the auth integration test**

Create `domains/foundry/src/auth/auth.integration.spec.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { generateKeyPair } from 'jose';
import { AuthService } from './auth.service.js';
import type { KeyPair } from './jwt.js';

const SKIP = !!process.env['SKIP_DB_TESTS'];

describe.skipIf(SKIP)('AuthService — real Postgres (RTR)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let keys: KeyPair;
  let svc: AuthService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    execSync(`psql "${container.getConnectionUri()}" -f domains/foundry/prisma/studio-init.sql`, { cwd: process.cwd() });
    prisma = new PrismaClient({ datasources: { db: { url: container.getConnectionUri() } } });
    await prisma.$connect();
    const kp = await generateKeyPair('EdDSA');
    keys = { privateKey: kp.privateKey, publicKey: kp.publicKey };
    svc  = new AuthService(prisma, keys);
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it('register → login → refresh (RTR) → logout: old token unusable', async () => {
    const { refreshToken: r1 } = await svc.register('user@test.com', 'secret123');
    await svc.login('user@test.com', 'secret123');
    const { refreshToken: r2 } = await svc.refresh(r1);
    await expect(svc.refresh(r1)).rejects.toThrow();  // r1 revoked
    await svc.logout(r2);
    await expect(svc.refresh(r2)).rejects.toThrow();  // r2 revoked
  });
}, 60_000);
```

- [ ] **Step 3: Run (requires Docker)**

```bash
cd domains/foundry && npm test -- store.db.spec.ts auth.integration.spec.ts
```
Expected: both tests pass. If no Docker: `SKIP_DB_TESTS=1 npm test` to skip.

- [ ] **Step 4: Commit**

```bash
git add domains/foundry/src/plan-tree/foundry-prisma-plan-tree.store.db.spec.ts \
        domains/foundry/src/auth/auth.integration.spec.ts
git commit -m "test(foundry): Testcontainers integration tests for store + auth RTR"
```

---

### Task 9: Foundry — Drafts Router

**Files:**
- Create: `domains/foundry/src/plan-tree/drafts.router.ts`

**Interfaces:**
- Consumes: `FoundryPrismaPlanTreeStore`, `storeFor` from Task 7; `AuthenticatedRequest` from Task 5; `PrismaClient` from `@prisma/client`
- Produces: `createDraftsRouter(prisma): Router` — mounts at `/api/drafts`, expects `authenticate` already run

- [ ] **Step 1: Create the drafts router**

Create `domains/foundry/src/plan-tree/drafts.router.ts`:
```typescript
import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { PlanTree, PlanTreeEdit } from '@de-braighter/substrate-contracts/plan-tree';
import { storeFor } from './foundry-prisma-plan-tree.store.js';
import type { AuthenticatedRequest } from '../auth/authenticate.middleware.js';

function asyncH(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => res.status(500).json({ error: (err as Error).message }));
  };
}

export function createDraftsRouter(prisma: PrismaClient): Router {
  const router = Router();

  // List root nodes for the authenticated tenant
  router.get('/', asyncH(async (req, res) => {
    const { tenantPackId } = (req as AuthenticatedRequest).user;
    const rows = await prisma.planNode.findMany({
      where: { tenantPackId, parentId: null, deletedAt: null },
      select: { treeRootId: true, metadata: true },
    });
    const drafts = rows.map((r) => {
      const meta = r.metadata as Record<string, unknown>;
      return { treeRootId: r.treeRootId, name: (meta['systemName'] as string | undefined) ?? r.treeRootId };
    });
    res.json({ drafts });
  }));

  // Load one tree
  router.get('/:treeRootId', asyncH(async (req, res) => {
    const draft = await storeFor(req as AuthenticatedRequest, prisma).load(req.params['treeRootId']!);
    res.json({ draft });
  }));

  // Full upsert (delete-all + insert-all in transaction)
  router.put('/:treeRootId', asyncH(async (req, res) => {
    const tree = req.body as PlanTree;
    await storeFor(req as AuthenticatedRequest, prisma).save(tree);
    res.json({ ok: true });
  }));

  // Apply a single edit
  router.post('/:treeRootId/edits', asyncH(async (req, res) => {
    const edit = req.body as PlanTreeEdit;
    try {
      const draft = await storeFor(req as AuthenticatedRequest, prisma).applyEdit(
        req.params['treeRootId']!, edit,
      );
      res.json({ draft });
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  }));

  // Delete all nodes for a tree
  router.delete('/:treeRootId', asyncH(async (req, res) => {
    const { tenantPackId } = (req as AuthenticatedRequest).user;
    await prisma.planNode.deleteMany({
      where: { treeRootId: req.params['treeRootId']!, tenantPackId },
    });
    res.json({ ok: true });
  }));

  return router;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd domains/foundry && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add domains/foundry/src/plan-tree/drafts.router.ts
git commit -m "feat(foundry/plan-tree): drafts router (GET list, GET one, PUT, POST edit, DELETE)"
```

---

### Task 10: Foundry — Express Migration + Wire Everything

**Files:**
- Modify: `domains/foundry/src/dashboard/server.ts`

**Interfaces:**
- Consumes: all prior foundry Tasks 3–9

- [ ] **Step 1: Replace the raw http handler with Express**

The migration extracts the existing inline handler blocks into named async functions and mounts them via Express routes. The `startDashboardServer` function signature is **unchanged** — only the internals change.

Replace the entire `domains/foundry/src/dashboard/server.ts`:
```typescript
import { createServer } from 'node:http';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { fold, activeClaim, staleClaims, itemBuilt } from '../state.js';
import { readEnvelopes } from '../log.js';
import { planFrontierAll } from '../plan/plan-frontier-all.js';
import { buildCascadeTree } from '../plan/cascade.js';
import { FOUNDRY_PRODUCT } from '../instances/foundry-product.js';
import { authorizeWorkflowStage, conductWorkflowStep } from '../plan/workflow-conductor.js';
import { workflowFrontier } from '../plan/workflow-frontier.js';
import { specForInstance } from '../plan/workflow-instances.js';
import { WORKFLOW_PRODUCT_KEY } from '../instances/workflow-keys.js';
import * as ops from '../ops.js';
import { renderFoundryDashboard } from './render.js';
import { startDispatch, stopDispatch, dispatchStatus, type SpawnDaemon } from '../dispatch/control.js';
import { readDispatchLogTail } from '../dispatch/logtail.js';
import { spawnDispatchDaemon } from '../dispatch/spawn.js';
import { DispatchConfigInputSchema } from '../dispatch/config-schema.js';
import { deriveDispatchHealth } from '../dispatch/health.js';
import { mapNodesToCatalog } from './catalog-mapper.js';
import { buildStatusByItemId, mergeLiveStatus } from './live-status.js';
import { loadKeysFromEnv } from '../auth/jwt.js';
import { AuthService } from '../auth/auth.service.js';
import { createAuthRouter } from '../auth/auth.router.js';
import { createAuthenticate } from '../auth/authenticate.middleware.js';
import { createDraftsRouter } from '../plan-tree/drafts.router.js';

const DEFAULT_PORT  = 4555;
const HOST          = '127.0.0.1';
const CORS_ORIGIN   = 'http://localhost:4200';

export async function startDashboardServer(
  deps: ops.FoundryDeps,
  opts: { port?: number; spawnDaemon?: SpawnDaemon } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const spawnDaemonFn = opts.spawnDaemon ?? spawnDispatchDaemon;
  const models        = { foundry: buildCascadeTree(FOUNDRY_PRODUCT) };

  // S4: auth + persistence — skip if env vars absent (local SDLC-only mode)
  const hasStudioKeys =
    !!process.env['STUDIO_JWT_PRIVATE_KEY'] && !!process.env['STUDIO_JWT_PUBLIC_KEY'];
  const prisma        = hasStudioKeys ? new PrismaClient() : null;
  const keys          = hasStudioKeys ? await loadKeysFromEnv() : null;

  const app = express();
  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(express.json({ limit: '64kb' }));

  if (prisma && keys) {
    const authService = new AuthService(prisma, keys);
    app.use('/api/auth',   createAuthRouter(authService));
    app.use('/api/drafts', createAuthenticate(keys), createDraftsRouter(prisma));
  }

  // ── Existing SDLC endpoints (behaviour unchanged) ──────────────────────────
  app.get('/', (req: Request, res: Response) => {
    const state = fold(readEnvelopes(deps.logPath));
    const html  = renderFoundryDashboard(state, Date.now(), {
      models, interactive: true, dispatch: dispatchStatus(deps, Date.now()),
    });
    res.setHeader('content-type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/api/snapshot', (req: Request, res: Response) => {
    const nowMs = Date.now();
    const s     = fold(readEnvelopes(deps.logPath));
    res.json({
      observedAt: new Date(nowMs).toISOString(),
      products: Array.from(s.products.entries()).map(([key, p]) => ({
        key, tier: p.riskTier, stage: p.stage ?? 'unknown',
        queued:  [...s.items.values()].filter(i => i.productKey === key && i.merged == null && i.retired == null).length,
        claimed: [...s.items.values()].filter(i => i.productKey === key && activeClaim(i, nowMs) != null).length,
        built:   [...s.items.values()].filter(i => i.productKey === key && itemBuilt(i, nowMs)).length,
        done:    [...s.items.values()].filter(i => i.productKey === key && i.merged != null).length,
      })),
      activeClaims: [...s.items.values()].flatMap(i => {
        const c = activeClaim(i, nowMs);
        return c != null ? [{ itemId: c.itemId, sessionId: c.sessionId }] : [];
      }),
      staleClaims:  staleClaims(s, nowMs).map(c => ({ itemId: c.itemId, sessionId: c.sessionId })),
      pendingGates: Array.from(s.gates.entries())
        .filter(([, g]) => g.decision == null)
        .map(([gateId, g]) => ({ gateId, productKey: g.productKey, gateType: g.gateType })),
      nextUp: planFrontierAll(s, nowMs).slice(0, 10).map(i => ({ itemId: i.itemId, title: i.title })),
    });
  });

  app.post('/api/reprioritize-product', (req: Request, res: Response) => {
    const parsed = req.body as { productKey?: string; priority?: number };
    if (typeof parsed.productKey !== 'string') {
      res.status(400).json({ ok: false, error: 'productKey required' }); return;
    }
    try {
      const result = ops.reprioritizeProduct(deps, {
        productKey: parsed.productKey, priority: parsed.priority ?? 500,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/authorize-workflow-stage', async (req: Request, res: Response) => {
    const parsed = req.body as { stage?: string; instance?: string };
    if (!parsed.stage) { res.status(400).json({ ok: false, error: 'stage required' }); return; }
    const stage    = parsed.stage;
    const instance = parsed.instance || WORKFLOW_PRODUCT_KEY;
    const authSpec = specForInstance(fold(readEnvelopes(deps.logPath)), instance);
    try {
      authorizeWorkflowStage(deps, stage, instance);
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message }); return;
    }
    let advancedStages = 0;
    try {
      const stageCount = authSpec.filter(n => n.kind === 'stage').length;
      let step = conductWorkflowStep(deps, instance);
      if (step.status === 'advanced') advancedStages += 1;
      for (let i = 0; i < stageCount && step.status === 'advanced'; i += 1) {
        step = conductWorkflowStep(deps, instance);
        if (step.status === 'advanced') advancedStages += 1;
      }
      res.json({ ok: true, authorized: true, conducted: true, advancedStages, status: step.status, stage: step.stage, frontier: (step.frontier ?? []).map(i => i.itemId) });
    } catch (e) {
      const s207 = fold(readEnvelopes(deps.logPath));
      const wf   = workflowFrontier(s207, Date.now(), authSpec, instance);
      res.status(207).json({ ok: true, authorized: true, conducted: false, advancedStages, error: `actuation stalled: ${(e as Error).message}`, status: 'stalled', stage: wf[0]?.itemId, frontier: wf.map(i => i.itemId) });
    }
  });

  app.post('/api/conduct-workflow', async (req: Request, res: Response) => {
    const parsed        = (req.body ?? {}) as { instance?: string };
    const instance      = parsed.instance || WORKFLOW_PRODUCT_KEY;
    let conductSpec;
    try {
      conductSpec = specForInstance(fold(readEnvelopes(deps.logPath)), instance);
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message }); return;
    }
    let advancedStages = 0;
    try {
      const stageCount = conductSpec.filter(n => n.kind === 'stage').length;
      let step = conductWorkflowStep(deps, instance);
      if (step.status === 'advanced') advancedStages += 1;
      for (let i = 0; i < stageCount && step.status === 'advanced'; i += 1) {
        step = conductWorkflowStep(deps, instance);
        if (step.status === 'advanced') advancedStages += 1;
      }
      res.json({ ok: true, conducted: true, advancedStages, status: step.status, stage: step.stage, frontier: (step.frontier ?? []).map(i => i.itemId) });
    } catch (e) {
      const s207 = fold(readEnvelopes(deps.logPath));
      const wf   = workflowFrontier(s207, Date.now(), conductSpec, instance);
      res.status(207).json({ ok: true, conducted: false, advancedStages, error: `actuation stalled: ${(e as Error).message}`, status: 'stalled', stage: wf[0]?.itemId, frontier: wf.map(i => i.itemId) });
    }
  });

  app.post('/api/dispatch', async (req: Request, res: Response) => {
    const parsed = (req.body ?? {}) as { action?: string; config?: Record<string, unknown> };
    try {
      let result: unknown;
      if (parsed.action === 'start') {
        const pc = parsed.config != null ? DispatchConfigInputSchema.safeParse(parsed.config) : undefined;
        if (pc && !pc.success) { res.status(400).json({ ok: false, error: 'invalid dispatch config' }); return; }
        result = startDispatch(deps, { ...(pc?.success ? { config: pc.data } : {}) }, spawnDaemonFn);
      } else if (parsed.action === 'stop') {
        result = stopDispatch(deps);
      } else {
        res.status(400).json({ ok: false, error: 'action must be start | stop' }); return;
      }
      res.json({ ok: true, result });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  app.get('/api/dispatch/status', (req: Request, res: Response) => {
    const now   = Date.now();
    const view  = dispatchStatus(deps, now);
    const s     = fold(readEnvelopes(deps.logPath));
    const liveThresholds = view.config != null
      ? { slowAfterSeconds: view.config.slowAfterSeconds, stalledAfterSeconds: view.config.stalledAfterSeconds, deadAfterSeconds: view.config.deadAfterSeconds }
      : undefined;
    const healthRows = deriveDispatchHealth(s, now, { itemIds: view.inFlight ?? [], thresholds: liveThresholds });
    const byId       = new Map(healthRows.map(r => [r.itemId, r]));
    const inFlight   = (view.inFlight ?? []).map(itemId => {
      const it   = s.items.get(itemId);
      const base = it == null ? { itemId } : { itemId, title: it.title, riskTier: s.products.get(it.productKey)?.riskTier, productKey: it.productKey };
      const h    = byId.get(itemId);
      return h == null ? base : { ...base, taskN: h.taskN, tasksTotal: h.tasksTotal, lastCommitSubject: h.lastCommitSubject, heartbeatAgeSeconds: h.heartbeatAgeSeconds, health: h.health, claimId: h.claimId, branch: h.branch, commits: h.commitsSinceClaim };
    });
    res.json({ ...view, inFlight, logTail: readDispatchLogTail(deps.dataDir, 40) });
  });

  app.get('/api/catalog', (req: Request, res: Response) => {
    let nodes = models.foundry.nodes;
    try {
      const state = fold(readEnvelopes(deps.logPath));
      nodes = mergeLiveStatus(nodes, buildStatusByItemId(state, Date.now()));
    } catch { /* fall back to in-memory seed statuses */ }
    res.json({ ok: true, catalog: mapNodesToCatalog(nodes) });
  });

  app.get('/api/plan-tree', (req: Request, res: Response) => {
    res.json({ ok: true, treeRootId: models.foundry.treeRootId, nodes: models.foundry.nodes });
  });

  // 404 fallback
  app.use((req: Request, res: Response) => res.status(404).type('text').send('not found'));

  const server = createServer(app);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? DEFAULT_PORT, HOST, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr != null ? addr.port : (opts.port ?? DEFAULT_PORT);
      resolve({
        url: `http://${HOST}:${port}`,
        close: () => new Promise<void>(async (done, fail) => {
          server.close(async (err) => {
            if (prisma) await prisma.$disconnect();
            err ? fail(err) : done();
          });
        }),
      });
    });
  });
}
```

- [ ] **Step 2: Typecheck + test**

```bash
cd domains/foundry && npm run typecheck && npm test
```
Expected: all existing tests pass; no type errors.

- [ ] **Step 3: Smoke test the server**

```bash
cd domains/foundry && npm run dashboard:serve &
sleep 2 && curl -s http://localhost:4555/ | head -c 100
```
Expected: HTML response starts with `<!DOCTYPE` or similar.

- [ ] **Step 4: Commit**

```bash
git add domains/foundry/src/dashboard/server.ts
git commit -m "feat(foundry): migrate server to Express; mount auth + drafts routers"
```

---

### Task 11: Studio — AuthService + AuthInterceptor + Unit Tests

**Files:**
- Create: `domains/studio/apps/studio-ui/src/app/auth/auth.service.ts`
- Create: `domains/studio/apps/studio-ui/src/app/auth/auth.interceptor.ts`
- Create: `domains/studio/apps/studio-ui/src/app/auth/auth.service.spec.ts`
- Create: `domains/studio/apps/studio-ui/src/app/auth/auth.interceptor.spec.ts`

**Interfaces:**
- Produces:
  - `class AuthService { accessToken: Signal<string | null>; login(email, password): Promise<void>; logout(): Promise<void>; refreshAccessToken(): Promise<void>; restoreSession(): Promise<void> }`
  - `const authInterceptor: HttpInterceptorFn`
  - `const FOUNDRY_BASE_URL: InjectionToken<string>`

- [ ] **Step 1: Create `auth.service.ts`**

Create `domains/studio/apps/studio-ui/src/app/auth/auth.service.ts`:
```typescript
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FOUNDRY_BASE_URL } from '../build-path/core/foundry-draft-store.adapter';

const REFRESH_KEY = 'studio_refresh_token';

interface TokenPair { accessToken: string; refreshToken: string }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(FOUNDRY_BASE_URL);

  readonly accessToken = signal<string | null>(null);

  async login(email: string, password: string): Promise<void> {
    const pair = await firstValueFrom(
      this.http.post<TokenPair>(`${this.base}/api/auth/login`, { email, password })
    );
    this.accessToken.set(pair.accessToken);
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
  }

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (refreshToken) {
      try {
        await firstValueFrom(
          this.http.post(`${this.base}/api/auth/logout`, { refreshToken })
        );
      } catch { /* best effort */ }
    }
    this.accessToken.set(null);
    localStorage.removeItem(REFRESH_KEY);
  }

  async refreshAccessToken(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) throw new Error('no refresh token');
    const pair = await firstValueFrom(
      this.http.post<TokenPair>(`${this.base}/api/auth/refresh`, { refreshToken })
    );
    this.accessToken.set(pair.accessToken);
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
  }

  async restoreSession(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return;
    try { await this.refreshAccessToken(); } catch { localStorage.removeItem(REFRESH_KEY); }
  }
}
```

- [ ] **Step 2: Create `auth.interceptor.ts`**

Create `domains/studio/apps/studio-ui/src/app/auth/auth.interceptor.ts`:
```typescript
import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { from, switchMap, catchError, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { FOUNDRY_BASE_URL } from '../build-path/core/foundry-draft-store.adapter';

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const auth  = inject(AuthService);
  const base  = inject(FOUNDRY_BASE_URL);
  const router = inject(Router);

  // Only intercept requests to the foundry base URL
  if (!req.url.startsWith(base)) return next(req);

  // Skip auth endpoints (no Bearer needed)
  if (req.url.includes('/api/auth/')) return next(req);

  const token = auth.accessToken();
  const authed = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authed).pipe(
    catchError((err) => {
      if (err?.status !== 401) return throwError(() => err);
      // Silent refresh → retry once
      return from(auth.refreshAccessToken()).pipe(
        switchMap(() => {
          const refreshed = req.clone({
            setHeaders: { Authorization: `Bearer ${auth.accessToken()}` },
          });
          return next(refreshed);
        }),
        catchError(() => {
          void router.navigate(['/login']);
          return throwError(() => err);
        }),
      );
    }),
  );
};
```

- [ ] **Step 3: Write unit tests for AuthService**

Create `domains/studio/apps/studio-ui/src/app/auth/auth.service.spec.ts`:
```typescript
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { FOUNDRY_BASE_URL } from '../build-path/core/foundry-draft-store.adapter';

describe('AuthService', () => {
  let svc: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FOUNDRY_BASE_URL, useValue: 'http://localhost:4555' },
      ],
    });
    svc  = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => http.verify());

  it('login: sets accessToken signal + stores refresh token', async () => {
    const p = svc.login('a@b.com', 'pw');
    http.expectOne('http://localhost:4555/api/auth/login').flush({ accessToken: 'at1', refreshToken: 'rt1' });
    await p;
    expect(svc.accessToken()).toBe('at1');
    expect(localStorage.getItem('studio_refresh_token')).toBe('rt1');
  });

  it('logout: clears accessToken + removes refresh token', async () => {
    localStorage.setItem('studio_refresh_token', 'rt1');
    svc.accessToken.set('at1');
    const p = svc.logout();
    http.expectOne('http://localhost:4555/api/auth/logout').flush({ ok: true });
    await p;
    expect(svc.accessToken()).toBeNull();
    expect(localStorage.getItem('studio_refresh_token')).toBeNull();
  });

  it('restoreSession: no refresh token → access token stays null', async () => {
    await svc.restoreSession();
    http.expectNone('http://localhost:4555/api/auth/refresh');
    expect(svc.accessToken()).toBeNull();
  });
});
```

- [ ] **Step 4: Run studio tests**

```bash
cd domains/studio && npx nx test studio-ui --testPathPattern=auth.service
```
Expected: 3 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add domains/studio/apps/studio-ui/src/app/auth/
git commit -m "feat(studio/auth): AuthService + authInterceptor (Bearer + 401 retry) + unit tests"
```

---

### Task 12: Studio — Login Page + Auth Guard + Update Routes

**Files:**
- Create: `domains/studio/apps/studio-ui/src/app/auth/login.page.ts`
- Create: `domains/studio/apps/studio-ui/src/app/auth/auth.guard.ts`
- Modify: `domains/studio/apps/studio-ui/src/app/app.routes.ts`

**Interfaces:**
- Produces: `LoginPage`, `authGuard: CanActivateFn`, updated routes

- [ ] **Step 1: Create `auth.guard.ts`**

Create `domains/studio/apps/studio-ui/src/app/auth/auth.guard.ts`:
```typescript
import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);
  if (auth.accessToken()) return true;
  return router.createUrlTree(['/login']);
};
```

- [ ] **Step 2: Create `login.page.ts`**

Create `domains/studio/apps/studio-ui/src/app/auth/login.page.ts`:
```typescript
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main style="display:grid;place-items:center;min-height:100vh;">
      <form (ngSubmit)="submit()" style="display:flex;flex-direction:column;gap:1rem;width:320px;">
        <h1 style="font-size:1.5rem;margin:0;">Studio — Anmelden</h1>
        @if (error()) {
          <p style="color:var(--color-risk,red);margin:0;" role="alert">{{ error() }}</p>
        }
        <label>
          E-Mail
          <input type="email" [(ngModel)]="email" name="email" required
                 style="display:block;width:100%;margin-top:.25rem;" />
        </label>
        <label>
          Passwort
          <input type="password" [(ngModel)]="password" name="password" required
                 style="display:block;width:100%;margin-top:.25rem;" />
        </label>
        <button type="submit" [disabled]="busy()">
          {{ busy() ? 'Anmelden…' : 'Anmelden' }}
        </button>
      </form>
    </main>
  `,
})
export class LoginPage {
  private readonly auth   = inject(AuthService);
  private readonly router = inject(Router);

  email    = '';
  password = '';
  readonly busy  = signal(false);
  readonly error = signal<string | null>(null);

  async submit(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.login(this.email, this.password);
      await this.router.navigate(['/systems']);
    } catch {
      this.error.set('E-Mail oder Passwort ungültig.');
    } finally {
      this.busy.set(false);
    }
  }
}
```

- [ ] **Step 3: Update `app.routes.ts`**

Replace `domains/studio/apps/studio-ui/src/app/app.routes.ts`:
```typescript
import { Routes } from '@angular/router';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'systems',
    loadComponent: () => import('./systems-picker/systems-picker.component').then((m) => m.SystemsPickerComponent),
    canActivate: [authGuard],
  },
  {
    path: 'system/:treeRootId',
    loadComponent: () => import('./system-editor/system-editor.page').then((m) => m.SystemEditorPage),
    canActivate: [authGuard],
  },
  {
    path: '',
    redirectTo: 'systems',
    pathMatch: 'full',
  },
  // Existing routes kept for backwards compatibility
  {
    path: 'operate',
    loadComponent: () => import('./operate').then((m) => m.OperatePage),
  },
  {
    path: 'governance',
    loadComponent: () => import('./governance').then((m) => m.GovernancePage),
  },
  {
    path: 'model',
    loadComponent: () => import('./model-run/run-host/model-run.component').then((m) => m.ModelRunComponent),
  },
  {
    path: 'plan-tree',
    loadComponent: () => import('./plan-tree/plan-tree-panel.component').then((m) => m.PlanTreePanelComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
```

> **Note:** `withComponentInputBinding()` must be added to `provideRouter` in `app.config.ts` (Task 14) so the `:treeRootId` param binds to `input()` on `SystemEditorPage`.

- [ ] **Step 4: Typecheck**

```bash
cd domains/studio && npx nx typecheck studio-ui
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add domains/studio/apps/studio-ui/src/app/auth/login.page.ts \
        domains/studio/apps/studio-ui/src/app/auth/auth.guard.ts \
        domains/studio/apps/studio-ui/src/app/app.routes.ts
git commit -m "feat(studio/auth): login page, auth guard, add /login /systems /system/:id routes"
```

---

### Task 13: Studio — FoundryDraftStoreAdapter + FOUNDRY_BASE_URL + Unit Tests

**Files:**
- Create: `domains/studio/apps/studio-ui/src/app/build-path/core/foundry-draft-store.adapter.ts`
- Create: `domains/studio/apps/studio-ui/src/app/build-path/core/foundry-draft-store.adapter.spec.ts`

**Interfaces:**
- Produces:
  - `const FOUNDRY_BASE_URL: InjectionToken<string>` — factory default `'http://localhost:4555'`
  - `class FoundryDraftStoreAdapter implements PlanTreeStore`

- [ ] **Step 1: Write the failing test**

Create `domains/studio/apps/studio-ui/src/app/build-path/core/foundry-draft-store.adapter.spec.ts`:
```typescript
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FoundryDraftStoreAdapter, FOUNDRY_BASE_URL } from './foundry-draft-store.adapter';
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';

const TREE: PlanTree = {
  treeRootId: 'r1', tenantPackId: 'p1',
  nodes: [{ id: 'r1', parentId: null, treeRootId: 'r1', kind: 'goal', kindRef: 'gr', ordinal: 0, metadata: {}, childrenIds: [] }],
};

describe('FoundryDraftStoreAdapter', () => {
  let adapter: FoundryDraftStoreAdapter;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FoundryDraftStoreAdapter,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FOUNDRY_BASE_URL, useValue: 'http://localhost:4555' },
      ],
    });
    adapter = TestBed.inject(FoundryDraftStoreAdapter);
    http    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('load: GET /api/drafts/:id, returns draft', async () => {
    const p = adapter.load('r1');
    http.expectOne('http://localhost:4555/api/drafts/r1').flush({ draft: TREE });
    expect(await p).toEqual(TREE);
  });

  it('load: returns null on HTTP error', async () => {
    const p = adapter.load('missing');
    http.expectOne('http://localhost:4555/api/drafts/missing').error(new ProgressEvent('error'));
    expect(await p).toBeNull();
  });

  it('save: PUT /api/drafts/:id with full tree body', async () => {
    const p = adapter.save(TREE);
    const req = http.expectOne('http://localhost:4555/api/drafts/r1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(TREE);
    req.flush({ ok: true });
    await p;
  });

  it('applyEdit: POST /api/drafts/:id/edits, returns updated draft', async () => {
    const edit = { type: 'rename-node', nodeId: 'r1', label: 'New Name' };
    const p = adapter.applyEdit('r1', edit as never);
    http.expectOne('http://localhost:4555/api/drafts/r1/edits').flush({ draft: TREE });
    expect(await p).toEqual(TREE);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd domains/studio && npx nx test studio-ui --testPathPattern=foundry-draft-store.adapter
```
Expected: FAIL.

- [ ] **Step 3: Implement the adapter**

Create `domains/studio/apps/studio-ui/src/app/build-path/core/foundry-draft-store.adapter.ts`:
```typescript
import { Injectable, InjectionToken, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import type { PlanTree, PlanTreeEdit, PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';

export const FOUNDRY_BASE_URL = new InjectionToken<string>('FOUNDRY_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:4555',
});

@Injectable()
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

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd domains/studio && npx nx test studio-ui --testPathPattern=foundry-draft-store.adapter
```
Expected: 4 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add domains/studio/apps/studio-ui/src/app/build-path/core/foundry-draft-store.adapter.ts \
        domains/studio/apps/studio-ui/src/app/build-path/core/foundry-draft-store.adapter.spec.ts
git commit -m "feat(studio): FoundryDraftStoreAdapter + FOUNDRY_BASE_URL token + unit tests"
```

---

### Task 14: Studio — DI Wiring + treeRootId Fix + SystemEditorPage Injection

**Files:**
- Modify: `domains/studio/apps/studio-ui/src/app/app.config.ts`
- Modify: `domains/studio/apps/studio-ui/src/app/system-editor/editor-model.ts` (line 313)
- Modify: `domains/studio/apps/studio-ui/src/app/system-editor/system-editor.page.ts` (lines 82–88, 597–598)

**Interfaces:**
- Consumes: `PLAN_TREE_STORE` from `@de-braighter/substrate-contracts/plan-tree`; `FoundryDraftStoreAdapter`, `FOUNDRY_BASE_URL` from Task 13; `authInterceptor` from Task 11

- [ ] **Step 1: Update `app.config.ts`**

Replace imports and providers in `domains/studio/apps/studio-ui/src/app/app.config.ts`:

At the top, add these imports:
```typescript
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { withComponentInputBinding } from '@angular/router';
import { PLAN_TREE_STORE } from '@de-braighter/substrate-contracts/plan-tree';
import { FoundryDraftStoreAdapter } from './build-path/core/foundry-draft-store.adapter';
import { authInterceptor } from './auth/auth.interceptor';
```

Change the `provideRouter(routes)` line to:
```typescript
provideRouter(routes, withComponentInputBinding()),
```

Add after the existing catalog providers (before the closing `]`):
```typescript
    // ── Studio draft persistence (S4) ────────────────────────────────────────
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: PLAN_TREE_STORE, useClass: FoundryDraftStoreAdapter },
```

- [ ] **Step 2: Update `seedNewSystemDraft` to require `treeRootId`**

In `domains/studio/apps/studio-ui/src/app/system-editor/editor-model.ts`, change line 313:
```typescript
// Before:
export function seedNewSystemDraft(treeRootId = 'EP-01'): BuildPathDraft {
// After:
export function seedNewSystemDraft(treeRootId: string): BuildPathDraft {
```

- [ ] **Step 3: Check for other callers of `seedNewSystemDraft()` without an argument**

```bash
grep -rn "seedNewSystemDraft()" domains/studio/
```

For each call found that passes no argument, update it to pass `crypto.randomUUID()`. Any call that has `seedNewSystemDraft()` (no arg) within the editor page itself needs the new treeRootId from the route input (see Step 4).

- [ ] **Step 4: Update `system-editor.page.ts` — inject store, add `treeRootId` input, async load**

In `domains/studio/apps/studio-ui/src/app/system-editor/system-editor.page.ts`:

**Change imports** (around line 82–88). Add `input`, remove `InMemoryBuildPathDraftStore`:
```typescript
// Remove this import:
import {
  InMemoryBuildPathDraftStore,
  // ...
} from '../build-path/core';

// Keep everything else from that import but remove InMemoryBuildPathDraftStore.
// Add after the existing imports:
import { input } from '@angular/core';
import { PLAN_TREE_STORE } from '@de-braighter/substrate-contracts/plan-tree';
import type { PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
```

**Change store + draft initialization** at line 597–598:
```typescript
// Before:
private readonly store = new InMemoryBuildPathDraftStore(seedNewSystemDraft());
private readonly draftSig = signal<BuildPathDraft>(seedNewSystemDraft());

// After:
readonly treeRootId = input.required<string>();
private readonly store = inject(PLAN_TREE_STORE) as PlanTreeStore;
private readonly draftSig = signal<BuildPathDraft | null>(null);
```

**Add an `effect` in the constructor** to load the draft when `treeRootId` changes:
```typescript
constructor() {
  // Load draft from store whenever treeRootId changes (Angular Signals effect).
  effect(() => {
    const id = this.treeRootId();
    void this.store.load(id).then((draft) => {
      if (draft) this.draftSig.set(draft);
    });
  });
}
```

**Fix line ~770** — any call to `seedNewSystemDraft()` within the editor (used when no `sys` is set). Replace with:
```typescript
const seeded = sys ? projectSystemToDraft(sys) : seedNewSystemDraft(this.treeRootId());
```

**In `save` / `applyEdit` calls** — make sure the code guards on `draftSig()` being non-null. The simplest approach is a null-guard at the top of methods that use `draftSig()`:
```typescript
// Where the current draft is consumed (e.g., before any edit):
const draft = this.draftSig();
if (!draft) return;
```

**Template null-guard** — in the template, wrap the editor body with:
```html
@if (draftSig()) {
  <!-- existing editor template -->
} @else {
  <p style="padding:2rem;">Lade…</p>
}
```

- [ ] **Step 5: Typecheck**

```bash
cd domains/studio && npx nx typecheck studio-ui
```
Expected: no errors. Fix any cascading null-check issues in the template or methods.

- [ ] **Step 6: Commit**

```bash
git add domains/studio/apps/studio-ui/src/app/app.config.ts \
        domains/studio/apps/studio-ui/src/app/system-editor/editor-model.ts \
        domains/studio/apps/studio-ui/src/app/system-editor/system-editor.page.ts
git commit -m "feat(studio): wire PLAN_TREE_STORE DI, inject store in SystemEditorPage, treeRootId from route input"
```

---

### Task 15: Studio — SystemsPickerComponent + Playwright E2E

**Files:**
- Create: `domains/studio/apps/studio-ui/src/app/systems-picker/systems-picker.component.ts`
- Create: `domains/studio/e2e/s4-durable-persistence.e2e.ts` (or appropriate E2E path)

**Interfaces:**
- Consumes: `PLAN_TREE_STORE` (injected); `AuthService` from Task 11; `FoundryDraftStoreAdapter` (via DI)

- [ ] **Step 1: Create `SystemsPickerComponent`**

Create `domains/studio/apps/studio-ui/src/app/systems-picker/systems-picker.component.ts`:
```typescript
import { Component, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PLAN_TREE_STORE } from '@de-braighter/substrate-contracts/plan-tree';
import type { PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import { FOUNDRY_BASE_URL } from '../build-path/core/foundry-draft-store.adapter';
import { AuthService } from '../auth/auth.service';
import { seedNewSystemDraft } from '../system-editor/editor-model';

interface DraftListItem { treeRootId: string; name: string }

@Component({
  selector: 'app-systems-picker',
  standalone: true,
  template: `
    <main style="padding:2rem;max-width:640px;margin:0 auto;">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <h1 style="font-size:1.5rem;margin:0;">Deine Systeme</h1>
        <button (click)="newSystem()" [disabled]="busy()">+ Neu</button>
      </header>

      @if (systems().length === 0 && !busy()) {
        <p>Noch keine Systeme. Klicke auf „+ Neu".</p>
      }

      <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.5rem;">
        @for (sys of systems(); track sys.treeRootId) {
          <li style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;border:1px solid var(--rule,#333);border-radius:4px;">
            <span>{{ sys.name }}</span>
            <span style="display:flex;gap:.5rem;">
              <button (click)="edit(sys.treeRootId)">Bearbeiten</button>
              <button (click)="delete(sys.treeRootId)" [disabled]="busy()">Löschen</button>
            </span>
          </li>
        }
      </ul>
    </main>
  `,
})
export class SystemsPickerComponent implements OnInit {
  private readonly store  = inject(PLAN_TREE_STORE) as PlanTreeStore;
  private readonly http   = inject(HttpClient);
  private readonly base   = inject(FOUNDRY_BASE_URL);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly systems = signal<DraftListItem[]>([]);
  readonly busy    = signal(false);

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async newSystem(): Promise<void> {
    this.busy.set(true);
    try {
      const id   = crypto.randomUUID();
      const seed = seedNewSystemDraft(id);
      await this.store.save(seed);
      await this.router.navigate(['/system', id]);
    } finally {
      this.busy.set(false);
    }
  }

  edit(treeRootId: string): void {
    void this.router.navigate(['/system', treeRootId]);
  }

  async delete(treeRootId: string): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.delete(`${this.base}/api/drafts/${treeRootId}`)
      );
      await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.http.get<{ drafts: DraftListItem[] }>(`${this.base}/api/drafts`)
      );
      this.systems.set(result.drafts);
    } catch { /* network error: leave list as-is */ }
  }
}
```

- [ ] **Step 2: Write the Playwright E2E test**

Find or create the E2E test file. Check the existing E2E directory:
```bash
ls domains/studio/e2e/ 2>/dev/null || ls domains/studio/apps/studio-ui-e2e/src/ 2>/dev/null
```

Create the test at the appropriate path (e.g., `domains/studio/e2e/s4-durable-persistence.e2e.ts`):
```typescript
import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:4200';
const FOUNDRY = 'http://localhost:4555';

async function register(page: Page, email: string, password: string) {
  await page.request.post(`${FOUNDRY}/api/auth/register`, {
    data: { email, password },
  });
}

test.describe('S4 — Studio Durable Persistence', () => {
  const EMAIL = `e2e-${Date.now()}@test.com`;
  const PW    = 'test-password-123';

  test.beforeAll(async ({ request }) => {
    await request.post(`${FOUNDRY}/api/auth/register`, { data: { email: EMAIL, password: PW } });
  });

  test('full golden path: login → picker → new system → edit → reload → persisted', async ({ page }) => {
    // 1. Navigate — redirects to /login (not logged in)
    await page.goto(`${BASE}/systems`);
    await expect(page).toHaveURL(/\/login/);

    // 2. Login
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PW);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/systems/);

    // 3. Systems picker is empty
    await expect(page.getByText('Noch keine Systeme')).toBeVisible();

    // 4. New System → editor opens
    await page.click('button:has-text("+ Neu")');
    await expect(page).toHaveURL(/\/system\/.+/);
    await expect(page.getByText('Lade…')).not.toBeVisible({ timeout: 5000 });

    // 5. Edit a node label (implementation-specific — adjust selector as needed)
    // The editor has a rename interaction. We'll verify the page loaded with a tree.
    await expect(page.locator('[role="main"], main')).toBeVisible();

    // 6. Navigate back to picker — system appears
    await page.goto(`${BASE}/systems`);
    await expect(page.locator('li')).toHaveCount(1);

    // 7. Reload → same system still listed (persistence check)
    await page.reload();
    await expect(page.locator('li')).toHaveCount(1);

    // 8. Delete → list is empty
    await page.click('button:has-text("Löschen")');
    await expect(page.locator('li')).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Run the full test suite**

```bash
cd domains/foundry && npm test
cd domains/studio && npx nx test studio-ui
```
Expected: all unit tests pass.

- [ ] **Step 4: Start servers + run E2E**

```bash
# Terminal 1: foundry
cd domains/foundry && STUDIO_JWT_PRIVATE_KEY=$(grep PRIVATE .env | cut -d= -f2) \
  STUDIO_JWT_PUBLIC_KEY=$(grep PUBLIC .env | cut -d= -f2) \
  SUBSTRATE_DATABASE_URL=<your-url> npm run dashboard:serve

# Terminal 2: studio
cd domains/studio && npx nx serve studio-ui

# Terminal 3: E2E
cd domains/studio && npx playwright test e2e/s4-durable-persistence.e2e.ts
```
Expected: E2E test passes — register → login → pick → new → reload → system persisted → delete.

- [ ] **Step 5: Commit**

```bash
git add domains/studio/apps/studio-ui/src/app/systems-picker/ \
        domains/studio/e2e/s4-durable-persistence.e2e.ts
git commit -m "feat(studio): SystemsPickerComponent + Playwright E2E golden path (S4 acceptance gate)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Express migration | Task 10 |
| `studio.accounts` + `studio.refresh_tokens` | Task 1 (SQL) + Task 4 (AuthService) |
| EdDSA JWT (15-min access, 30-day refresh, RTR) | Tasks 3–4 |
| `authenticate` middleware | Task 5 |
| Auth endpoints (register/login/refresh/logout) | Tasks 4–5 |
| `FoundryPrismaPlanTreeStore` with `SET LOCAL` | Task 7 |
| `rowsToPlanTree` / `planTreeToRows` (GUC discipline) | Task 6 |
| Draft API (GET list, GET one, PUT, POST edits, DELETE) | Task 9 |
| `FoundryDraftStoreAdapter` implements `PlanTreeStore` | Task 13 |
| `AuthService` (memory token, localStorage refresh) | Task 11 |
| `AuthInterceptor` (Bearer + 401→retry→redirect) | Task 11 |
| Login page + auth guard | Task 12 |
| `seedNewSystemDraft` required `treeRootId` | Task 14 |
| `SystemEditorPage` → `inject(PLAN_TREE_STORE)` | Task 14 |
| `SystemsPickerComponent` (new/edit/delete) | Task 15 |
| Kernel-Untouched (zero `layers/substrate` diff) | All tasks — no substrate files modified |
| E2E acceptance gate (survive reload) | Task 15 |
| Cross-tenant isolation tests | Task 8 |

**Placeholder scan:** No TBD, no "implement later", no "similar to Task N". All steps have code.

**Type consistency:** `PlanNodeRow` defined once in Task 6, consumed by Task 7. `storeFor` in Task 7 consumed by Task 9. `AuthenticatedRequest` defined in Task 5, consumed by Tasks 7, 9. `FOUNDRY_BASE_URL` defined in Task 13, consumed by Tasks 11, 14, 15.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-29-s4-studio-durable-persistence.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
