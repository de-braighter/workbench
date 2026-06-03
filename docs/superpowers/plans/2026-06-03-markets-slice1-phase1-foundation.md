# Markets Domain — Slice 1 / Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a building, testing, empty-but-real `markets` domain — a pnpm-workspace with two libraries (`source-spine`, `markets-pack`) and a NestJS app (`markets-api`) exposing `/health` — and register it in the workbench cluster manifest.

**Architecture:** New sibling repo `de-braighter/markets` at `domains/markets/`, mirroring the herdbook full-stack archetype but with **pnpm workspaces only (no nx)** — root scripts drive `pnpm -r run build|typecheck|test`. Phase 1 carries **no `@de-braighter/*` dependencies** (substrate enters in Phase 2), so it is green with no GitHub-Packages auth. The `SourcePort` contract + its types are locked here as the foundation the Phase-2 adapters implement.

**Tech Stack:** TypeScript 5.4 (NodeNext), pnpm 9, Vitest 1.6, NestJS 10 (`@nestjs/common`/`core`/`platform-express`), `reflect-metadata`.

**Spec:** `docs/superpowers/specs/2026-06-03-markets-external-source-integration-design.md`

**Cross-repo note:** Tasks 1–6 create files in the **new** `domains/markets/` repo (its own git repo, gitignored from the workbench). Task 7 edits the **workbench** repo (`repos.yaml` + `projects/markets/project.yaml`) on a separate branch. Task 8 (GitHub remote) is a confirm-with-user step.

**Ports chosen (avoid collisions with exercir 3100/5545, herdbook 3200/5433):** `markets-api` HTTP = **3300**; markets Postgres (Phase 2) = **5455**.

---

## File Structure (Phase 1)

```text
domains/markets/                         NEW repo de-braighter/markets
├── package.json                         pnpm workspace root, pnpm -r scripts
├── pnpm-workspace.yaml                  packages: libs/*, apps/*
├── tsconfig.base.json                   NodeNext + NestJS decorators
├── .npmrc                               @de-braighter → GitHub Packages (for Phase 2)
├── .gitignore                           node_modules, dist, coverage, .env
├── README.md                            what + how to run/test
├── libs/source-spine/                   reusable capability (NO market knowledge)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts                     re-exports the contract
│       ├── source-port.ts               SourcePort interface + types (LOCKED here)
│       └── source-port.spec.ts          contract conformance smoke test
├── libs/markets-pack/                   demo consumer (skeleton)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts
│       └── index.spec.ts
└── apps/markets-api/                    NestJS host (skeleton: /health only)
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    └── src/
        ├── main.ts
        └── app/
            ├── app.module.ts
            ├── health.controller.ts
            └── health.controller.spec.ts
```

---

## Task 1: Workspace root + git init

**Files:**
- Create: `domains/markets/package.json`
- Create: `domains/markets/pnpm-workspace.yaml`
- Create: `domains/markets/tsconfig.base.json`
- Create: `domains/markets/.npmrc`
- Create: `domains/markets/.gitignore`
- Create: `domains/markets/README.md`

- [ ] **Step 1: Create the repo directory and initialize git**

Run:
```bash
mkdir -p D:/development/projects/de-braighter/domains/markets
cd D:/development/projects/de-braighter/domains/markets
git init -b main
```
Expected: `Initialized empty Git repository in .../domains/markets/.git/`

- [ ] **Step 2: Write `package.json` (workspace root)**

```json
{
  "name": "@de-braighter/markets-workspace",
  "version": "0.0.0",
  "private": true,
  "description": "Markets — external-source integration demonstrator on the de-braighter substrate. The source spine (declare → adapt → ground observations → provenance → confidence gating) is the reusable deliverable; crypto markets is the demo consumer.",
  "type": "module",
  "scripts": {
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck",
    "ci:local": "pnpm run build && pnpm run typecheck && pnpm run test"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@vitest/coverage-v8": "1.6.1",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  },
  "packageManager": "pnpm@9.1.0"
}
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - 'libs/*'
  - 'apps/*'
```

- [ ] **Step 4: Write `tsconfig.base.json`** (mirrors herdbook; NodeNext + decorators for NestJS)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "baseUrl": "."
  }
}
```

- [ ] **Step 5: Write `.npmrc`** (prepares Phase-2 substrate resolution; harmless in Phase 1)

```ini
@de-braighter:registry=https://npm.pkg.github.com
```

Note: this machine already has GitHub-Packages auth (devloop/herdbook resolve `@de-braighter/*`). No `@de-braighter/*` dependency is installed until Phase 2, so Phase 1 install needs no token.

- [ ] **Step 6: Write `.gitignore`**

```gitignore
node_modules/
dist/
coverage/
*.tsbuildinfo
.env
.env.*
!.env.example
```

- [ ] **Step 7: Write `README.md`**

```markdown
# markets

External-source integration **demonstrator** on the de-braighter substrate.

The reusable deliverable is the **source spine** (`libs/source-spine`): declare an
external source → adapt it → ground observations → capture provenance → gate
confidence on source health. **Crypto markets** (`libs/markets-pack` + the
`apps/markets-api` host) is the demo consumer. Pack-on-platform, zero kernel change.

Design: `de-braighter/workbench` → `docs/superpowers/specs/2026-06-03-markets-external-source-integration-design.md`

## Develop

    pnpm install
    pnpm run ci:local        # build + typecheck + test (all packages)

## Layout

- `libs/source-spine` — the reusable capability (no market knowledge)
- `libs/markets-pack`  — the demo consumer (CoinGecko source, observations, lens)
- `apps/markets-api`   — NestJS host (`GET /health`; `GET /readout` from Phase 3)

Phase 1 = this scaffold. Phase 2 = the spine + persisted ingestion to
`kernel.event_log`. Phase 3 = the published inference backbone + readout.
```

- [ ] **Step 8: Install and verify the empty workspace resolves**

Run:
```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm install
```
Expected: completes with `Done in …` and no `ERR_PNPM`. (No packages yet → only root devDeps install.)

- [ ] **Step 9: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add package.json pnpm-workspace.yaml tsconfig.base.json .npmrc .gitignore README.md
git commit -m "chore: scaffold markets pnpm workspace root

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `source-spine` library — lock the `SourcePort` contract (TDD)

**Files:**
- Create: `domains/markets/libs/source-spine/package.json`
- Create: `domains/markets/libs/source-spine/tsconfig.json`
- Create: `domains/markets/libs/source-spine/vitest.config.ts`
- Create: `domains/markets/libs/source-spine/src/source-port.ts`
- Create: `domains/markets/libs/source-spine/src/index.ts`
- Test: `domains/markets/libs/source-spine/src/source-port.spec.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@de-braighter/markets-source-spine",
  "version": "0.0.0",
  "private": true,
  "description": "Source spine — reusable external-source integration capability (SourcePort, provenance, source-health, confidence gating). No market knowledge.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts", "dist", "node_modules"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
```

- [ ] **Step 4: Write the failing contract test**

`domains/markets/libs/source-spine/src/source-port.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { SourcePort, SourceResult, SourceDescriptor } from './source-port.js';

// A trivial in-test adapter PROVES the contract compiles + is usable.
// (Real adapters land in Phase 2.)
const descriptor: SourceDescriptor = {
  id: 'fake',
  name: 'Fake source',
  category: 'Test',
  required: true,
  latencyBudgetMs: 60_000,
};

class FakeSource implements SourcePort<{ price: number }> {
  readonly descriptor = descriptor;
  async fetch(): Promise<SourceResult<{ price: number }>> {
    return {
      ok: true,
      value: {
        payload: { price: 100 },
        provenance: { sourceId: 'fake', fetchedAt: '2026-06-03T00:00:00.000Z', payloadHash: 'abc' },
      },
    };
  }
}

describe('SourcePort contract', () => {
  it('an adapter exposes a descriptor and fetch() returning a provenance-stamped payload', async () => {
    const src = new FakeSource();
    expect(src.descriptor.id).toBe('fake');
    expect(src.descriptor.required).toBe(true);
    const result = await src.fetch();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload.price).toBe(100);
      expect(result.value.provenance.sourceId).toBe('fake');
      expect(result.value.provenance.fetchedAt).toBe('2026-06-03T00:00:00.000Z');
    }
  });
});
```

- [ ] **Step 5: Run the test to verify it fails (no `source-port.ts` yet)**

Run:
```bash
cd D:/development/projects/de-braighter/domains/markets/libs/source-spine
pnpm install
pnpm run test
```
Expected: FAIL — `Cannot find module './source-port.js'` (or a resolution error).

- [ ] **Step 6: Write the contract `source-port.ts`**

```typescript
/** Health of a declared source, derived from feed freshness vs. its latency budget. */
export type SourceHealthStatus = 'online' | 'stale' | 'offline';

/** A declared external feed. `required` sources cap model confidence when not online. */
export interface SourceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly required: boolean;
  /** Freshness threshold (ms): older than this without an update → 'stale'. */
  readonly latencyBudgetMs: number;
}

/** Audit trail for one fetch: which source, when, and a hash of the raw payload. */
export interface Provenance {
  readonly sourceId: string;
  readonly fetchedAt: string; // ISO 8601 UTC
  readonly payloadHash: string; // sha256 hex of the raw payload
}

/** A successful fetch: the typed payload plus its provenance. */
export interface SourceFetch<TPayload> {
  readonly payload: TPayload;
  readonly provenance: Provenance;
}

/** Why a fetch failed. `rate-limited` is treated downstream as 'degraded', not fatal. */
export interface SourceError {
  readonly kind: 'unreachable' | 'rate-limited' | 'bad-shape' | 'unknown';
  readonly detail: string;
}

/** Never-throws result at the source boundary (the messy external edge). */
export type SourceResult<TPayload> =
  | { readonly ok: true; readonly value: SourceFetch<TPayload> }
  | { readonly ok: false; readonly error: SourceError };

/** The boundary every adapter implements. Isolates the external edge from the core. */
export interface SourcePort<TPayload> {
  readonly descriptor: SourceDescriptor;
  fetch(): Promise<SourceResult<TPayload>>;
}
```

- [ ] **Step 7: Write `index.ts` (public surface)**

```typescript
export type {
  SourceHealthStatus,
  SourceDescriptor,
  Provenance,
  SourceFetch,
  SourceError,
  SourceResult,
  SourcePort,
} from './source-port.js';
```

- [ ] **Step 8: Run the test to verify it passes**

Run:
```bash
cd D:/development/projects/de-braighter/domains/markets/libs/source-spine
pnpm run test
```
Expected: PASS — 1 passed.

- [ ] **Step 9: Verify it builds and typechecks**

Run:
```bash
pnpm run typecheck && pnpm run build
```
Expected: no errors; `dist/index.js` + `dist/index.d.ts` produced.

- [ ] **Step 10: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/source-spine
git commit -m "feat(source-spine): lock the SourcePort contract + types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `markets-pack` library skeleton (TDD)

**Files:**
- Create: `domains/markets/libs/markets-pack/package.json`
- Create: `domains/markets/libs/markets-pack/tsconfig.json`
- Create: `domains/markets/libs/markets-pack/vitest.config.ts`
- Create: `domains/markets/libs/markets-pack/src/index.ts`
- Test: `domains/markets/libs/markets-pack/src/index.spec.ts`

- [ ] **Step 1: Write `package.json`** (declares the workspace dep on source-spine; Phase 2 fills it in)

```json
{
  "name": "@de-braighter/markets-pack",
  "version": "0.0.0",
  "private": true,
  "description": "Markets pack — the demo consumer of the source spine (CoinGecko source, observation mapping, inference lens).",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@de-braighter/markets-source-spine": "workspace:*"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts", "dist", "node_modules"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
```

- [ ] **Step 4: Write the failing test** (proves the pack can import the spine contract)

`domains/markets/libs/markets-pack/src/index.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { PACK_ID } from './index.js';

describe('markets-pack', () => {
  it('declares its pack id', () => {
    expect(PACK_ID).toBe('markets');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run:
```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm install
pnpm run test
```
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 6: Write `index.ts`**

```typescript
// Re-export the spine contract so the host depends on the pack, not the spine
// directly (the spine graduates to a shared layer later — keep that seam clean).
export type { SourcePort, SourceDescriptor, SourceResult } from '@de-braighter/markets-source-spine';

/** Stable pack discriminator (used as DomainEventEnvelope.packId in Phase 2). */
export const PACK_ID = 'markets' as const;
```

- [ ] **Step 7: Run the test to verify it passes**

Run:
```bash
pnpm run test
```
Expected: PASS — 1 passed.

- [ ] **Step 8: Build + typecheck (proves cross-lib workspace resolution)**

Run:
```bash
pnpm run typecheck && pnpm run build
```
Expected: no errors. (If `Cannot find module '@de-braighter/markets-source-spine'`, run `pnpm install` at the workspace root and ensure `libs/source-spine` was built in Task 2.)

- [ ] **Step 9: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/markets-pack
git commit -m "feat(markets-pack): skeleton consuming the source-spine contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `markets-api` NestJS host with `GET /health` (TDD)

**Files:**
- Create: `domains/markets/apps/markets-api/package.json`
- Create: `domains/markets/apps/markets-api/tsconfig.json`
- Create: `domains/markets/apps/markets-api/vitest.config.ts`
- Create: `domains/markets/apps/markets-api/src/main.ts`
- Create: `domains/markets/apps/markets-api/src/app/app.module.ts`
- Create: `domains/markets/apps/markets-api/src/app/health.controller.ts`
- Test: `domains/markets/apps/markets-api/src/app/health.controller.spec.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@de-braighter/markets-api",
  "version": "0.0.0",
  "private": true,
  "description": "Markets NestJS host. Phase 1: GET /health. Phase 3 adds GET /readout.",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "start": "node --import tsx src/main.ts"
  },
  "dependencies": {
    "@de-braighter/markets-pack": "workspace:*",
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.0",
    "tsx": "^4.7.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`** (apps don't emit `.d.ts`; they run)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node", "reflect-metadata"],
    "declaration": false,
    "composite": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts", "dist", "node_modules"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
```

- [ ] **Step 4: Write the failing controller test**

`domains/markets/apps/markets-api/src/app/health.controller.spec.ts`:
```typescript
import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('GET /health returns status ok', () => {
    expect(controller.health()).toEqual({ status: 'ok', pack: 'markets' });
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run:
```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
pnpm install
pnpm run test
```
Expected: FAIL — `Cannot find module './health.controller.js'`.

- [ ] **Step 6: Write `health.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common';
import { PACK_ID } from '@de-braighter/markets-pack';

@Controller('health')
export class HealthController {
  @Get()
  health(): { status: 'ok'; pack: string } {
    return { status: 'ok', pack: PACK_ID };
  }
}
```

- [ ] **Step 7: Write `app.module.ts`** (Phase 1: no substrate yet)

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 8: Write `main.ts`**

```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env['PORT'] ?? 3300);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`markets-api listening on http://localhost:${port}`);
}

void bootstrap();
```

- [ ] **Step 9: Run the test to verify it passes**

Run:
```bash
pnpm run test
```
Expected: PASS — 1 passed.

- [ ] **Step 10: Typecheck, then live-verify the server boots and answers**

Run:
```bash
pnpm run typecheck
pnpm run start &
sleep 3
curl -s http://localhost:3300/health
```
Expected: `{"status":"ok","pack":"markets"}`. Then stop the server (`kill %1` on bash; on Windows note the German-netstat `ABHÖREN` locale when finding the PID — see the herdbook run memory).

- [ ] **Step 11: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add apps/markets-api
git commit -m "feat(markets-api): NestJS host with GET /health

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full workspace gate green

**Files:** none (verification + a `.gitignore` confirm).

- [ ] **Step 1: Run the full local gate from the workspace root**

Run:
```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run ci:local
```
Expected: `build` (3 packages), `typecheck` (3 packages), `test` (3 passed) all succeed.

- [ ] **Step 2: Confirm no build artifacts are tracked**

Run:
```bash
git status --short
```
Expected: clean (no `dist/`, `node_modules/`, `coverage/` showing — all gitignored). If any appear, fix `.gitignore` and commit it.

---

## Task 6: (workbench repo) register markets in the cluster manifest

**Files (in the WORKBENCH repo, not domains/markets):**
- Modify: `repos.yaml`
- Create: `projects/markets/project.yaml`

- [ ] **Step 1: Branch the workbench off main**

Run:
```bash
cd D:/development/projects/de-braighter
git checkout -b chore/register-markets-domain main
```

- [ ] **Step 2: Add `markets` to `repos.yaml` domains**

In `repos.yaml`, under `domains:`, append after the `herdbook` line:
```yaml
    - markets         # external-source integration demonstrator (source spine + crypto consumer)
```

- [ ] **Step 3: Create `projects/markets/project.yaml`**

```yaml
# markets — external-source integration demonstrator
# Status: bootstrapping — Phase 1 (foundation) scaffolded; spine + ingestion + inference to follow.
# Form: pack-on-platform (ADR-027), zero kernel change (ADR-176). Full runtime coupling:
#       substrate-runtime host, persisted kernel.event_log, published INFERENCE_BACKBONE.
# Design: docs/superpowers/specs/2026-06-03-markets-external-source-integration-design.md

name: markets
domain: external-source-integration
status: bootstrapping
repo: github.com/de-braighter/markets
local: domains/markets/

# Hints for orchestrator judgment, not enforcement. markets is a full-stack
# substrate consumer (NestJS + Prisma + RLS, thin readout page), so the curation
# skews backend + substrate + a little UI.
enabled:
  agents:
    suggested:
      - designer
      - substrate-architect
      - substrate-coder-pro
      - implementer
      - reviewer
      - charter-checker
      - qa-engineer
      - local-ci
      - prisma-pro
      - test-pro
  skills:
    suggested:
      - architecture-concierge
      - diff-refactor-engine
      - md-quality-review
      - nx-tag-architecture-governance
```

- [ ] **Step 4: Verify only the two intended files are staged** (workbench carries unrelated untracked WIP — never `git add -A`)

Run:
```bash
cd D:/development/projects/de-braighter
git add repos.yaml projects/markets/project.yaml
git status --short
```
Expected: exactly `M repos.yaml` and `A projects/markets/project.yaml`; all other entries remain `??` (untracked, unstaged).

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(manifest): register markets domain in repos.yaml + project descriptor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: (confirm-with-user) create the GitHub remote and push

> Outward-facing — do NOT run without explicit confirmation. The local repo + commits from Tasks 1–5 are complete and usable without a remote.

- [ ] **Step 1: Confirm with the user**, then create the remote and push

```bash
cd D:/development/projects/de-braighter/domains/markets
gh repo create de-braighter/markets --private --source=. --remote=origin --push
```
Expected: repo created; `main` pushed. (Note: the local `gh` token lacks `read:org`/title scopes — `gh repo create` with `--source` works, but `gh pr edit` does not; see the gh-token memory.)

- [ ] **Step 2: Open the workbench registration PR** (from Task 6's branch)

```bash
cd D:/development/projects/de-braighter
git push -u origin chore/register-markets-domain
gh pr create --title "chore: register markets domain" --body "$(cat <<'EOF'
Registers the new `markets` domain (external-source integration demonstrator) in the cluster manifest + a project descriptor. Repo scaffold (Phase 1 foundation) lives in `de-braighter/markets`.

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans]
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage (Phase 1 portion only):** The spec's "libs" architecture (`source-spine`, `markets-pack`, `apps/markets-api`) → Tasks 2/3/4. The `SourcePort` contract (spec §Definitions + Components) → Task 2. Workbench registration (spec implies a new domain) → Task 6. The spec's *substantive* features (CoinGecko adapter, provenance/health/confidence-gate impls, persisted ingestion, inference lens, `/readout`) are **deferred to Phase 2/3 by design** — Phase 1 is foundation only. No Phase-1 requirement is unaddressed.

**Placeholder scan:** No TBD/TODO. Every code block is complete and runnable. The one `eslint-disable` comment in `main.ts` is intentional (console log on boot).

**Type consistency:** `SourcePort`, `SourceDescriptor`, `SourceResult`, `Provenance`, `SourceFetch`, `SourceError`, `SourceHealthStatus` defined once in Task 2 §Step 6 and re-exported in Task 2 §Step 7 / Task 3 §Step 6. `PACK_ID` defined in Task 3 §Step 6, consumed in Task 4 §Step 6. Package names (`@de-braighter/markets-source-spine`, `@de-braighter/markets-pack`, `@de-braighter/markets-api`) are consistent across all `package.json` deps and imports.

---

## Phase 2 / Phase 3 preview (NOT this plan)

- **Phase 2 — Spine + persisted ingestion:** TDD `provenance` (sha256), `source-health` (`deriveHealth(fetchedAt, now, latencyBudgetMs)` → `online|stale|offline`), `confidence-gate` (`capConfidence(raw, health, required)`); the `CoinGeckoAdapter` (real `/simple/price`) + `FixtureAdapter` (recorded snapshot); observation → `DomainEventEnvelope` mapping; the DB foundation (published `app-roles.sql` + `core-schema.sql`, demo tenant, RLS, `SubstrateModule.forRoot({...})`); append via `DOMAIN_EVENT_PUBLISHER.publishAll(envelopes, tx)`. Live-verify: real CoinGecko fetch → rows in `kernel.event_log`.
- **Phase 3 — Inference + readout:** `InferenceCatalog` (a `conjugateHint: 'normal'` indicator + an `ObservationProjection` JsonPath over the recorded events); a degenerate plan-tree root; a `world` subject; `INFERENCE_BACKBONE.posterior({ tenantPackId, treeRoot, subject, indicatorKey })`; wire the confidence gate over the posterior; `GET /readout` + one small page. **Precondition:** read the installed `@de-braighter/substrate-contracts/inference` `InferenceCatalog`/`ObservationProjection` `.d.ts` + exercir's `buildPackFootballInferenceCatalog` for a verbatim registration example before writing Phase-3 tasks.
