# `/new-domain` Scaffolder Skill Implementation Plan

> **⚠️ SUPERSEDED — STALE API.** Executed 2026-06-03; kept as a frozen execution
> artifact. The substrate API details in here (`kind:'person'` subjects, 4-arg
> `InferenceBackboneRouter`, `^0.14`/`^0.19` pins) predate substrate 1.2.0. The
> shipped skill at `.claude/skills/new-domain/SKILL.md` is authoritative
> (workbench#117 / PR #118). Do NOT follow API details here.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `new-domain` skill at `de-braighter/.claude/skills/new-domain/` — a `SKILL.md` (frontmatter + 8-step Process with inline gotcha callouts) plus a `templates/{foundation,db,inference,ui}/` tree and `WORKBENCH-REGISTRATION.md`, codifying the shipped markets reference run as a tiered scaffolder.

**Architecture:** Markdown-instruction skill, no build code (the workbench is declarative-content-only). Template files are inert: `.tmpl` suffix on anything tooling might pick up as live config; `{{TOKEN}}` placeholders the skill substitutes on copy. Template *content* is lifted from the generic, domain-knowledge-free parts of `domains/markets/` (the substrate plumbing) — markets' domain specifics (CoinGecko, crypto assets, log_price) are reduced to clearly-marked **EXAMPLE** stubs the founder replaces after scaffolding.

**Tech Stack:** Markdown + YAML frontmatter. Validation uses `node -e` JSON.parse checks (node is available) — no committed scripts.

**Spec:** `docs/superpowers/specs/2026-06-03-new-domain-scaffolder-skill-design.md`

**Repo:** `de-braighter/workbench` (this is a `.claude/skills/` change — **PR-gated**, branch in the workbench repo).

**Reference source:** `domains/markets/` (shipped Phase 1/2/3). When a step says "lift from `domains/markets/<path>`", read that file and apply the tokenization rules below.

**Tokenization rules (apply on every `.tmpl`/template file):**
| markets literal | token |
|---|---|
| `markets` (pack id, repo, scope segment, dir) | `{{DOMAIN}}` |
| `Markets` / PascalCase | `{{DOMAIN_PASCAL}}` |
| `3300` (api http port) | `{{HTTP_PORT}}` |
| `5455` (postgres host port) | `{{PG_PORT}}` |
| the long description string | `{{PURPOSE}}` |

The tenant UUIDs (`10000000-0000-4000-8000-000000000001` etc.) stay literal — they're the demo-tenant constants every fresh domain reuses.

---

## File Structure

```
de-braighter/.claude/skills/new-domain/
  SKILL.md                                    Task 1 (frontmatter+spine), 3,4,5,6,7 (steps)
  WORKBENCH-REGISTRATION.md                   Task 7
  templates/
    foundation/                               Task 2
      package.json.tmpl  pnpm-workspace.yaml  tsconfig.base.json.tmpl
      npmrc.tmpl  gitignore.tmpl  README.md.tmpl
      libs/spine/{package.json.tmpl, tsconfig.json.tmpl, vitest.config.ts,
                  src/index.ts, src/index.spec.ts, README.md.tmpl}
      libs/pack/{package.json.tmpl, tsconfig.json.tmpl, vitest.config.ts,
                 src/index.ts, src/constants.ts, src/index.spec.ts}
      apps/api/{package.json.tmpl, tsconfig.json.tmpl, vitest.config.ts,
                src/main.ts, src/app/app.module.ts,
                src/app/health.controller.ts, src/app/health.controller.spec.ts}
    db/                                        Task 4
      docker-compose.yml.tmpl  env.example.tmpl
      tools/db/{env.mjs, setup.mjs, seed.mjs}  seed.sql
      app-module-db.snippet.md
    inference/                                 Task 5
      inference-catalog.example.ts  readout.service.example.ts
      readout.controller.ts  app-module-inference.snippet.md
    ui/                                        Task 6
      proxy.conf.json.tmpl  cors.snippet.md  tokens.css
      asset-card.example.{ts,html,css}  app-component.example.{ts,html,css}
```

`.tmpl` files have placeholders tooling would choke on (package.json, tsconfig, etc.) **or** would otherwise look like a live workspace member; the skill strips `.tmpl` on copy. `npmrc.tmpl`/`gitignore.tmpl`/`env.example.tmpl` use `.tmpl` only to avoid the leading-dot dotfile being copied/ignored by accident — the skill renames them to `.npmrc`/`.gitignore`/`.env.example`. Plain-named `.ts`/`.mjs`/`.css` files are inert (they live under `.claude/skills/`, outside any workspace glob).

---

## Task 1: Skill directory + SKILL.md frontmatter + spine

**Files:**
- Create: `de-braighter/.claude/skills/new-domain/SKILL.md`

- [ ] **Step 1: Branch the workbench**

```bash
cd D:/development/projects/de-braighter
git checkout -b feat/new-domain-skill main
```

- [ ] **Step 2: Write `SKILL.md` frontmatter + opening + Steps 0–1**

Create `de-braighter/.claude/skills/new-domain/SKILL.md`:
````markdown
---
name: new-domain
description: Use when standing up a brand-new substrate domain in the de-braighter cluster — scaffold a building, testing, registered pnpm-workspace domain (reusable spine lib + pack lib + NestJS api), optionally with the DB-persistence, inference-backbone, and Angular-UI tiers. Codifies the markets reference run.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, TodoWrite
tags: [tooling, scaffolding]
---

# New Domain

Scaffold a brand-new substrate domain in the de-braighter cluster: a **building, testing,
registered, empty-but-real** pnpm-workspace domain (reusable spine lib + pack lib + NestJS
api with `GET /health`), with optional **DB persistence**, **inference backbone**, and
**Angular UI** tiers. Pack-on-platform (ADR-027), zero kernel change (ADR-176).

Run from the cluster root (`de-braighter/`, this workbench's working tree — the `.claude/`
host). The new domain is created as a sibling repo under `domains/<name>/` (its own git repo,
gitignored at the root), consuming the published `@de-braighter/*` packages.

This skill was extracted from the **markets reference run** (`domains/markets/`, Phase 1/2/3).
The substrate-consumer gotchas it carries are real and verified — see the callouts in each
tier and the [markets-domain-arc memory] for the full catalog.

## What this produces vs what it does NOT

PRODUCES: workspace structure, substrate wiring, `/health` (+ `/readout` if inference), green
`ci:local`, workbench registration. Does NOT design your domain's features, choose the
conjugate family / observation shape, promote anything into the kernel, or publish substrate
packages. After scaffolding, brainstorm the actual domain features as a separate cycle.

## Template mechanics

Templates live under `templates/<tier>/`. To apply a tier: copy its tree into the domain,
**rename** `*.tmpl` → strip the suffix (and `npmrc`/`gitignore`/`env.example` → `.npmrc`/
`.gitignore`/`.env.example`), then substitute these tokens in every copied file:

| token | value |
|---|---|
| `{{DOMAIN}}` | the kebab domain name (Step 1) |
| `{{DOMAIN_PASCAL}}` | PascalCase of the name |
| `{{HTTP_PORT}}` | chosen api port |
| `{{PG_PORT}}` | chosen postgres port |
| `{{PURPOSE}}` | the one-line purpose |

Substitute with Read+Write per file, or a documented loop, e.g. (bash):
```bash
find "$DEST" -type f | while read f; do
  sed -i "s/{{DOMAIN}}/$DOMAIN/g; s/{{DOMAIN_PASCAL}}/$PASCAL/g; \
          s/{{HTTP_PORT}}/$HTTP/g; s/{{PG_PORT}}/$PG/g" "$f"
done
```
(Substitute `{{PURPOSE}}` separately — it contains spaces/punctuation; prefer Read+Write.)

## Process

Track every step with TodoWrite.

### Step 0 — Preconditions
Confirm the working tree is the cluster root `de-braighter/` (the `.claude/` host) and that
`domains/<name>/` does not already exist. The published `@de-braighter/*` packages resolve via
the existing GitHub-Packages auth (devloop/herdbook/markets already resolve them).

### Step 1 — Interactive intake (`AskUserQuestion`)
Ask, in one prompt set:
1. **Domain name** (kebab, e.g. `logistics`).
2. **One-line purpose**.
3. **Port pair** — grep `repos.yaml` + `domains/*/docker-compose.yml` for taken ports and
   **suggest the next free pair** (known: exercir 3100/5545, herdbook 3200/5433, markets
   3300/5455 → suggest **3400/5465**); let the founder override. HTTP + Postgres.
4. **Tiers** (multi-select): DB persistence · inference backbone *(requires DB)* · Angular UI.
   Foundation always runs.

Record the answers. Add one TodoWrite group per selected tier.
````

- [ ] **Step 3: Validate the frontmatter parses**

```bash
cd D:/development/projects/de-braighter
node -e "const fs=require('fs');const t=fs.readFileSync('.claude/skills/new-domain/SKILL.md','utf8');const m=t.match(/^---\n([\s\S]*?)\n---/);if(!m)throw new Error('no frontmatter');for(const k of ['name:','description:','allowed-tools:','tags:'])if(!m[1].includes(k))throw new Error('missing '+k);console.log('frontmatter OK');"
```
Expected: `frontmatter OK`

- [ ] **Step 4: Commit**

```bash
cd D:/development/projects/de-braighter
git add .claude/skills/new-domain/SKILL.md
git commit -m "feat(new-domain): skill frontmatter + intake (Steps 0-1)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Foundation templates

**Files (all under `de-braighter/.claude/skills/new-domain/templates/foundation/`):**
- Create the workspace-root config + spine lib + pack lib + api skeleton (see steps).

- [ ] **Step 1: Workspace-root config**

`templates/foundation/package.json.tmpl` (lift from `domains/markets/package.json`, tokenized; **drop** the `db:*`/`ci:local:db` scripts — those ship with the DB tier):
```json
{
  "name": "@de-braighter/{{DOMAIN}}-workspace",
  "version": "0.0.0",
  "private": true,
  "description": "{{PURPOSE}}",
  "type": "module",
  "scripts": {
    "build":     "pnpm -r run build",
    "test":      "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck",
    "ci:local":  "pnpm run build && pnpm run typecheck && pnpm run test"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@vitest/coverage-v8": "1.6.1",
    "typescript": "^5.4.5",
    "vitest": "1.6.1"
  },
  "engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" },
  "packageManager": "pnpm@9.1.0"
}
```

`templates/foundation/pnpm-workspace.yaml` (verbatim):
```yaml
packages:
  - 'libs/*'
  - 'apps/*'
```

`templates/foundation/tsconfig.base.json.tmpl` — lift `domains/markets/tsconfig.base.json` verbatim (no tokens; it has none).

`templates/foundation/npmrc.tmpl`:
```
@de-braighter:registry=https://npm.pkg.github.com
```

`templates/foundation/gitignore.tmpl`:
```
node_modules/
dist/
.angular/
coverage/
*.tsbuildinfo
.env
.env.local
.env.*.local
!.env.example
```

`templates/foundation/README.md.tmpl`:
```markdown
# {{DOMAIN}}

{{PURPOSE}}

Substrate domain on the de-braighter cluster (pack-on-platform, ADR-027). Consumes the
published `@de-braighter/*` packages.

## Develop

    pnpm install
    pnpm run ci:local        # build + typecheck + test (all packages)

## Layout

- `libs/{{DOMAIN}}-spine` — reusable capability (no domain knowledge)
- `libs/{{DOMAIN}}-pack`  — the domain pack (consumes the spine)
- `apps/{{DOMAIN}}-api`   — NestJS host (`GET /health`)
```

- [ ] **Step 2: Spine lib (`templates/foundation/libs/spine/`)**

`package.json.tmpl`:
```json
{
  "name": "@de-braighter/{{DOMAIN}}-spine",
  "version": "0.0.0",
  "private": true,
  "description": "{{DOMAIN_PASCAL}} spine — reusable capability for the {{DOMAIN}} domain. No domain knowledge.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" } },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`tsconfig.json.tmpl` — lift `domains/markets/libs/source-spine/tsconfig.json` verbatim (no tokens).

`vitest.config.ts` — lift `domains/markets/libs/source-spine/vitest.config.ts` verbatim.

`src/index.ts` (generic placeholder — the founder replaces with the domain's reusable contract):
```typescript
// The reusable capability for this domain lives here — domain-knowledge-free contracts
// and helpers. Replace this placeholder with your domain's first contract.
export const SPINE_READY = true;
```

`src/index.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { SPINE_READY } from './index.js';

describe('{{DOMAIN}}-spine', () => {
  it('is wired', () => {
    expect(SPINE_READY).toBe(true);
  });
});
```

`README.md.tmpl`:
```markdown
# {{DOMAIN}}-spine

Reusable capability for the {{DOMAIN}} domain — domain-knowledge-free contracts + helpers.
(Markets' reference run put its `SourcePort` external-source contract here.)
```

- [ ] **Step 3: Pack lib (`templates/foundation/libs/pack/`)**

`package.json.tmpl`:
```json
{
  "name": "@de-braighter/{{DOMAIN}}-pack",
  "version": "0.0.0",
  "private": true,
  "description": "{{DOMAIN_PASCAL}} pack — the domain pack (consumes the {{DOMAIN}}-spine).",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" } },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@de-braighter/{{DOMAIN}}-spine": "workspace:*"
  }
}
```

`tsconfig.json.tmpl` — lift `domains/markets/libs/markets-pack/tsconfig.json` verbatim.

`vitest.config.ts` — lift `domains/markets/libs/markets-pack/vitest.config.ts` verbatim.

`src/constants.ts`:
```typescript
export const PACK_ID = '{{DOMAIN}}' as const;
```

`src/index.ts`:
```typescript
export { PACK_ID } from './constants.js';
```

`src/index.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { PACK_ID } from './index.js';

describe('{{DOMAIN}}-pack', () => {
  it('declares its pack id', () => {
    expect(PACK_ID).toBe('{{DOMAIN}}');
  });
});
```

- [ ] **Step 4: API skeleton (`templates/foundation/apps/api/`)**

`package.json.tmpl`:
```json
{
  "name": "@de-braighter/{{DOMAIN}}-api",
  "version": "0.0.0",
  "private": true,
  "description": "{{DOMAIN_PASCAL}} NestJS host. Foundation: GET /health.",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "start": "node dist/main.js",
    "start:dev": "node --import tsx src/main.ts"
  },
  "dependencies": {
    "@de-braighter/{{DOMAIN}}-pack": "workspace:*",
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
> Callout in SKILL.md Step 2: `start` runs the **compiled** `dist/main.js` — NOT `tsx/esm`,
> which doesn't emit `reflect-metadata` and breaks NestJS DI (controllers' injected services
> become undefined).

`tsconfig.json.tmpl` — lift `domains/markets/apps/markets-api/tsconfig.json` verbatim (it carries `declaration:false` + `declarationMap:false` — keep them).

`vitest.config.ts` — lift `domains/markets/apps/markets-api/vitest.config.ts` verbatim.

`src/main.ts`:
```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env['PORT'] ?? {{HTTP_PORT}});
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`{{DOMAIN}}-api listening on http://localhost:${port}`);
}

void bootstrap();
```

`src/app/app.module.ts` (foundation: no substrate yet — tiers extend it):
```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
export class AppModule {}
```

`src/app/health.controller.ts`:
```typescript
import { Controller, Get } from '@nestjs/common';
import { PACK_ID } from '@de-braighter/{{DOMAIN}}-pack';

@Controller('health')
export class HealthController {
  @Get()
  health(): { status: 'ok'; pack: string } {
    return { status: 'ok', pack: PACK_ID };
  }
}
```

`src/app/health.controller.spec.ts` — lift `domains/markets/apps/markets-api/src/app/health.controller.spec.ts` verbatim, tokenizing `markets` → `{{DOMAIN}}`.

- [ ] **Step 5: Validate the foundation templates substitute to valid output (dry-run)**

```bash
cd D:/development/projects/de-braighter
rm -rf /tmp/nd-dry && cp -r .claude/skills/new-domain/templates/foundation /tmp/nd-dry
find /tmp/nd-dry -name "*.tmpl" | while read f; do mv "$f" "${f%.tmpl}"; done
find /tmp/nd-dry -type f | while read f; do sed -i "s/{{DOMAIN}}/widget/g; s/{{DOMAIN_PASCAL}}/Widget/g; s/{{HTTP_PORT}}/3400/g; s/{{PG_PORT}}/5465/g; s/{{PURPOSE}}/A test domain/g" "$f"; done
# every .json must parse:
find /tmp/nd-dry -name "*.json" | while read f; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK $f"; done
```
Expected: every `package.json`/`tsconfig*.json` prints `OK`. No `SyntaxError`. (Note `tsconfig.base.json` has no tokens; it still must parse.)

- [ ] **Step 6: Commit**

```bash
cd D:/development/projects/de-braighter
git add .claude/skills/new-domain/templates/foundation
git commit -m "feat(new-domain): foundation tier templates (workspace + spine + pack + api/health)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: SKILL.md Step 2 (foundation process) + substitution section

**Files:**
- Modify: `de-braighter/.claude/skills/new-domain/SKILL.md`

- [ ] **Step 1: Append Step 2 to the Process section**

After Step 1 in SKILL.md, append:
````markdown
### Step 2 — Foundation tier (always)
1. `mkdir domains/{{DOMAIN}}` then `cd` in and `git init -b main`.
2. Copy `templates/foundation/**` into `domains/{{DOMAIN}}/`, rename `*.tmpl` (and
   `npmrc`/`gitignore`/`README.md.tmpl` dotfiles), substitute tokens (see Template mechanics).
3. Rename the lib dirs: `libs/spine` → `libs/{{DOMAIN}}-spine`, `libs/pack` →
   `libs/{{DOMAIN}}-pack`, `apps/api` → `apps/{{DOMAIN}}-api`.
4. `pnpm install` (resolves only root devDeps + the workspace libs).
5. Verify TDD smoke tests are red→green if you author the contract; the shipped placeholders
   are already green. Run `pnpm run ci:local` — build + typecheck + test must pass.
6. Live-verify the api:
   ```bash
   cd apps/{{DOMAIN}}-api && pnpm run build && node dist/main.js &
   sleep 4 && curl -s http://localhost:{{HTTP_PORT}}/health   # → {"status":"ok","pack":"{{DOMAIN}}"}
   ```
   **GOTCHA — use `node dist/main.js`, NOT `node --import tsx src/main.ts`.** tsx/esbuild does
   not emit `reflect-metadata`, so NestJS DI silently fails (injected services become
   `undefined`). The `start` script already points at the compiled output.
7. Commit each package as you go (workspace root, then spine, pack, api). Commit the
   `pnpm-lock.yaml`.
````

- [ ] **Step 2: Validate the SKILL.md still has parseable frontmatter + references Template mechanics**

```bash
cd D:/development/projects/de-braighter
grep -q "Template mechanics" .claude/skills/new-domain/SKILL.md && grep -q "### Step 2 — Foundation" .claude/skills/new-domain/SKILL.md && echo "Step 2 present"
```
Expected: `Step 2 present`

- [ ] **Step 3: Commit**

```bash
cd D:/development/projects/de-braighter
git add .claude/skills/new-domain/SKILL.md
git commit -m "feat(new-domain): SKILL.md foundation process (Step 2)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: DB tier templates + SKILL.md Step 3

**Files (under `templates/db/`):**

- [ ] **Step 1: DB infra templates**

`templates/db/docker-compose.yml.tmpl` (lift `domains/markets/docker-compose.yml`, tokenize the service name `markets-db` → `{{DOMAIN}}-db`, `markets` db name → `{{DOMAIN}}`, host port `5455` → `{{PG_PORT}}`, volume `markets-db-data` → `{{DOMAIN}}-db-data`).

`templates/db/env.example.tmpl` (lift `domains/markets/.env.example`, tokenize `markets` → `{{DOMAIN}}`, `5455` → `{{PG_PORT}}`; **keep** the tenant UUID literal and `SUBSTRATE_RLS_ENABLED=true`):
```
# Copy to .env and fill in values. .env is gitignored.
DATABASE_URL_MIGRATE=postgresql://postgres:postgres@localhost:{{PG_PORT}}/{{DOMAIN}}
DATABASE_URL=postgresql://postgres:postgres@localhost:{{PG_PORT}}/{{DOMAIN}}
SUBSTRATE_APP_DATABASE_URL=postgresql://app:app@localhost:{{PG_PORT}}/{{DOMAIN}}
SUBSTRATE_RLS_ENABLED=true
{{DOMAIN_PASCAL_UPPER}}_TENANT_PACK_ID=10000000-0000-4001-8000-000000000001
```
> Note: replace `{{DOMAIN_PASCAL_UPPER}}` with the upper-snake env-var prefix at copy time
> (e.g. `LOGISTICS`); document this in the SKILL Step 3.

`templates/db/tools/db/env.mjs` — lift `domains/markets/tools/db/env.mjs` verbatim (no tokens; it's path-relative).

`templates/db/tools/db/setup.mjs` — lift `domains/markets/tools/db/setup.mjs`, tokenizing the `apps/markets-api` resolution anchor → `apps/{{DOMAIN}}-api`. **Keep** the `kernel-plan-tree.sql` step only-if-inference: include it but add a comment that it's only needed when the inference tier is present.

`templates/db/seed.sql` — lift `domains/markets/tools/db/seed.sql` verbatim (it seeds the kernel.plan_node root; tenant UUIDs stay literal). Only used by the inference tier; ship it here so the DB tier's `seed.mjs` has a target.

`templates/db/tools/db/seed.mjs` — lift `domains/markets/tools/db/seed.mjs`, tokenizing `apps/markets-api` → `apps/{{DOMAIN}}-api`.

- [ ] **Step 2: AppModule DB-wiring snippet**

`templates/db/app-module-db.snippet.md` — a markdown snippet the skill splices into the api's `app.module.ts`. Lift the DB-wiring from `domains/markets/apps/markets-api/src/app/app.module.ts` (the `appRoleClient` + fail-fast guard + `SubstrateModule.forRoot({prismaClient,…})` + `GucPrismaRunner` + explicit `DOMAIN_EVENT_PUBLISHER` providers), tokenizing `markets` → `{{DOMAIN}}`. Wrap it in a fenced `typescript` block with a one-line "splice into AppModule" header.

- [ ] **Step 3: Append Step 3 to SKILL.md (DB tier)**

````markdown
### Step 3 — DB persistence tier (if selected)
1. Copy `templates/db/**` into the domain (`docker-compose.yml`, `.env.example`, `tools/db/*`).
   Rename `*.tmpl`, substitute tokens, and replace `{{DOMAIN_PASCAL_UPPER}}` with the
   upper-snake env prefix. `cp .env.example .env`.
2. Add the DB scripts to the root `package.json`: `db:start` (`docker compose up -d
   {{DOMAIN}}-db`), `db:setup` (`node tools/db/setup.mjs`), `db:seed` (`node tools/db/seed.mjs`),
   `ci:local:db` (`pnpm run db:start && pnpm run db:setup && [pnpm run db:seed &&] pnpm run ci:local`).
3. Add deps to `apps/{{DOMAIN}}-api`: `@de-braighter/substrate-contracts@^0.14.0`,
   `@de-braighter/substrate-runtime@^0.19.0`, `@prisma/client@^6`, `prisma@^6` (dev). Add a
   `prisma/schema.prisma` with the vendored `EventLog`+`Outbox` kernel models
   (`@@schema("kernel")`, multi-schema datasource) — lift from
   `domains/markets/apps/markets-api/prisma/schema.prisma`.
4. Splice `templates/db/app-module-db.snippet.md` into `app.module.ts`.
5. `docker compose up -d {{DOMAIN}}-db && pnpm run db:setup`, then live-verify writes.

**GOTCHAS (DB):**
- `db:setup` runs `app-roles` / `core-schema` / `kernel-event-log` (+ `kernel-plan-tree` if
  inference) from `@de-braighter/substrate-runtime/sql` via `prisma db execute`.
- AppModule needs a fail-fast guard on `SUBSTRATE_APP_DATABASE_URL` (else PrismaClient falls
  back to the admin URL and bypasses RLS), and `SUBSTRATE_RLS_ENABLED=true` to activate the
  GUC in `GucPrismaRunner`.
- `SubstrateModule.forRoot({ prismaClient: appRoleClient, … })` does NOT auto-bind the
  publisher — add an explicit `{ provide: DOMAIN_EVENT_PUBLISHER, useValue: new PrismaOutboxWriter() }`.
- `DomainEventEnvelope` / `DOMAIN_EVENT_PUBLISHER` import from
  `@de-braighter/substrate-contracts/events` (re-exported from substrate-runtime root).
- `kernel.plan_node` (inference): column is `kind` (not `type`), root needs `tree_root_id = id`,
  and `title` + `created_by` are NOT NULL (no default) → use sentinels in seed.sql.
````

- [ ] **Step 4: Validate db `.json` templates parse + snippet is fenced**

```bash
cd D:/development/projects/de-braighter
rm -rf /tmp/nd-db && cp -r .claude/skills/new-domain/templates/db /tmp/nd-db
find /tmp/nd-db -name "*.tmpl" | while read f; do mv "$f" "${f%.tmpl}"; done
find /tmp/nd-db -type f | while read f; do sed -i "s/{{DOMAIN}}/widget/g; s/{{PG_PORT}}/5465/g" "$f"; done
grep -q '```typescript' .claude/skills/new-domain/templates/db/app-module-db.snippet.md && echo "snippet fenced OK"
node -e "require('fs').readFileSync('/tmp/nd-db/docker-compose.yml','utf8')" && echo "compose readable"
```
Expected: `snippet fenced OK` + `compose readable` (no token braces remain in the substituted compose — spot-check `grep '{{' /tmp/nd-db/docker-compose.yml` returns nothing).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter
git add .claude/skills/new-domain/templates/db .claude/skills/new-domain/SKILL.md
git commit -m "feat(new-domain): DB tier templates + SKILL.md Step 3

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Inference tier templates + SKILL.md Step 4

**Files (under `templates/inference/`):**

- [ ] **Step 1: Inference templates (EXAMPLE-marked — generic, not crypto)**

`templates/inference/inference-catalog.example.ts` — lift the STRUCTURE of
`domains/markets/apps/markets-api/src/config/markets-catalog.ts` + the projection from
`domains/markets/libs/markets-pack/src/inference/inference-catalog.ts`, but rename the
indicator to a generic example and add a header comment `// EXAMPLE — replace
'{{DOMAIN}}.example_indicator' + the projection paths with your domain's indicator.`:
```typescript
// EXAMPLE inference catalog — replace the indicator key, prior, and projection paths
// with your domain's real indicator. Lives in apps/{{DOMAIN}}-api/src/config/ (NOT the
// library — the lib must not depend on substrate-runtime).
import {
  asJsonPath, type ObservationProjection, type IndicatorKey,
} from '@de-braighter/substrate-contracts/inference';
import { InMemoryInferenceCatalog } from '@de-braighter/substrate-runtime';

export const EXAMPLE_INDICATOR_KEY = '{{DOMAIN}}.example_indicator' as IndicatorKey;

function requireJsonPath(raw: string) {
  const r = asJsonPath(raw);
  if (!r.ok) throw new Error(`Invalid JsonPath "${raw}": ${r.error.message}`);
  return r.value;
}

export const EXAMPLE_PROJECTION: ObservationProjection = {
  indicatorKey: EXAMPLE_INDICATOR_KEY,
  source: 'event-log',
  eventTypes: ['{{DOMAIN}}:ExampleObserved.v1'],
  numeratorPath: requireJsonPath('value'),
  timestampPath: requireJsonPath('observedAt'),
};

export function build{{DOMAIN_PASCAL}}Catalog(): InMemoryInferenceCatalog {
  return new InMemoryInferenceCatalog([
    {
      indicatorKey: EXAMPLE_INDICATOR_KEY,
      conjugateHint: 'normal',     // or 'beta' / 'lognormal'
      priorMean: 0, priorSd: 5, observationSd: 1,
      observationProjection: EXAMPLE_PROJECTION,
    },
  ]);
}
```

`templates/inference/readout.service.example.ts` — lift the STRUCTURE of
`domains/markets/apps/markets-api/src/readout/readout.service.ts`, generalized: keep the
`posterior()` call + `Result {ok,value,error}` handling + the `kind:'person'` subject, but
mark it EXAMPLE and replace the 3-asset loop with a single example subject. Header:
`// EXAMPLE readout — replace the subject(s) and the value mapping with your domain's.`

`templates/inference/readout.controller.ts` — lift `domains/markets/apps/markets-api/src/readout/readout.controller.ts` verbatim, tokenized (`GET /readout` delegating to the service).

`templates/inference/app-module-inference.snippet.md` — the 5-provider chain, lifted from
`domains/markets/apps/markets-api/src/app/app.module.ts` (the inference providers block),
tokenized, in a fenced `typescript` block.

- [ ] **Step 2: Append Step 4 to SKILL.md (inference tier)**

````markdown
### Step 4 — Inference backbone tier (if selected; requires DB)
1. Copy `templates/inference/**`. Put `inference-catalog.example.ts` +
   `readout.service.example.ts` + `readout.controller.ts` under
   `apps/{{DOMAIN}}-api/src/config/` and `…/src/readout/`. Strip the `.example` once you've
   replaced the EXAMPLE indicator/subject with your domain's.
2. Ensure `db:setup` includes the `kernel-plan-tree.sql` step and `db:seed` seeds the plan
   root (Step 3 ships both).
3. Splice `app-module-inference.snippet.md` into AppModule (the 5-provider chain) and add the
   `inferenceCatalog`/backbone wiring.
4. Live-verify `GET /readout` after a few `POST /ingest` (or your write path).

**GOTCHAS (inference):**
- `asJsonPath()` returns `Result<JsonPath,…>`, not a string → wrap with `requireJsonPath()`
  (throw on `!ok`). The inference `Result` shape is `{ok, value, error}` (NOT fp-ts
  `{_tag,right,left}`).
- The 5-provider chain (all explicit — backbone is NOT auto-bound):
  `INFERENCE_CATALOG` → `EVIDENCE_REPOSITORY` (`new PrismaEvidenceLogRepository(runner,
  catalog)`) → `NUMPYRO_SIDECAR` (`null`) → `MEMBER_RESOLUTION_PORT` (no-op that throws) →
  `INFERENCE_BACKBONE` (`new InferenceBackboneRouter(catalog, evidence, sidecar, members)`).
  `INFERENCE_BACKBONE`/`NUMPYRO_SIDECAR` from `…/inference`; `MEMBER_RESOLUTION_PORT` from
  contracts root.
- The Normal-Normal fast-path **rejects non-`person` subjects** → represent domain entities as
  `{ kind: 'person', id: <UUID> }` (the backbone only uses `subject.id` for the
  `aggregate_id` filter against `kernel.event_log`).
- `build{{DOMAIN_PASCAL}}Catalog()` lives in `apps/{{DOMAIN}}-api/src/config/` — the **library
  must not depend on substrate-runtime** (`InMemoryInferenceCatalog` is a runtime impl).
- `@Inject(Token)` on constructor params injected by class type (vitest/esbuild emits no
  decorator metadata).
- `PackManifest.key` (not `.packId`) in contracts 0.14.0.
````

- [ ] **Step 3: Validate inference snippet is fenced + example files tokenize cleanly**

```bash
cd D:/development/projects/de-braighter
grep -q '```typescript' .claude/skills/new-domain/templates/inference/app-module-inference.snippet.md && echo "inference snippet fenced OK"
rm -rf /tmp/nd-inf && cp -r .claude/skills/new-domain/templates/inference /tmp/nd-inf
find /tmp/nd-inf -type f | while read f; do sed -i "s/{{DOMAIN}}/widget/g; s/{{DOMAIN_PASCAL}}/Widget/g" "$f"; done
grep -rL '{{' /tmp/nd-inf/*.ts >/dev/null && echo "no stray tokens in .ts" || echo "CHECK: stray tokens"
```
Expected: `inference snippet fenced OK` + `no stray tokens in .ts`.

- [ ] **Step 4: Commit**

```bash
cd D:/development/projects/de-braighter
git add .claude/skills/new-domain/templates/inference .claude/skills/new-domain/SKILL.md
git commit -m "feat(new-domain): inference tier templates + SKILL.md Step 4

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: UI tier templates + SKILL.md Step 5

**Files (under `templates/ui/`):**

- [ ] **Step 1: UI templates (EXAMPLE-marked)**

`templates/ui/proxy.conf.json.tmpl` — lift `domains/markets/apps/markets-ui/proxy.conf.json`
(the `/api` → `:{{HTTP_PORT}}` with dev tenant headers). Keep the tenant UUID + pack header
tokenized (`x-pack-id: {{DOMAIN}}`).

`templates/ui/cors.snippet.md` — the one-liner `app.enableCors({ origin:
'http://localhost:<ui-port>' })` to splice into the api's `main.ts`, in a fenced block.

`templates/ui/tokens.css` — lift `domains/markets/apps/markets-ui/src/tokens.css` verbatim
(generic de-braighter design tokens; the per-asset accent comment can stay as an example).

`templates/ui/app-component.example.{ts,html,css}` — lift the markets `AppComponent` (polling
shell + Ingest button), marked EXAMPLE, generalized labels. Keep the `catchError(() =>
of(null))` polling-recovery pattern.

`templates/ui/asset-card.example.{ts,html,css}` — lift the markets `AssetCardComponent`, marked
EXAMPLE (glass panel, `[ngClass]` health badge), generalized to a single "item card."

- [ ] **Step 2: Append Step 5 to SKILL.md (UI tier)**

````markdown
### Step 5 — Angular UI tier (if selected)
1. Scaffold an Angular CLI standalone app at `apps/{{DOMAIN}}-ui` (use the latest Angular the
   installed Node supports — check `node --version` against the CLI's engine requirement):
   `ng new {{DOMAIN}}-ui --standalone --routing=false --style=css --skip-git --skip-install`
   (answer `--no-interactive` / decline analytics + SSR).
2. Set the dev-server port + proxy in `angular.json` serve options: `"port": <ui-port>`,
   `"proxyConfig": "proxy.conf.json"`. Copy `templates/ui/proxy.conf.json` (tokenized).
3. Copy `tokens.css` + the EXAMPLE component templates; wire `provideHttpClient()` in
   `app.config.ts`. Splice `cors.snippet.md` into the api `main.ts`.
4. **Set the UI `package.json` test script to `ng test --watch=false --browsers=ChromeHeadless`**
   BEFORE running any workspace gate.
5. `pnpm install` at the root; `npx ng build`; live-verify the page in a browser.

**GOTCHAS (UI):**
- **The scaffolded `ng test` defaults to watch mode + a visible browser.** Once `apps/{{DOMAIN}}-ui`
  joins the `apps/*` glob, `pnpm -r run test` (the workspace `ci:local`) HANGS FOREVER. Fix the
  UI `test` script to `ng test --watch=false --browsers=ChromeHeadless` (exits clean) before
  the first gate run.
- Add the dev tenant headers to `proxy.conf.json` — the global `TenantPackContextGuard`
  requires `x-tenant-id` (the TENANT_ID, NOT tenant_pack_id), `x-pack-id`, `x-user-id` (must
  be a UUID). The proxy is dev-only.
- Keep polling alive on transient errors: `catchError(() => of(null))` INSIDE `switchMap`
  (a raw error terminates the RxJS stream permanently).
- `[ngClass]` (not `[class]`) for additive classes — `[class]="str"` replaces the static class.
````

- [ ] **Step 3: Validate proxy template + ui snippet**

```bash
cd D:/development/projects/de-braighter
rm -rf /tmp/nd-ui && cp -r .claude/skills/new-domain/templates/ui /tmp/nd-ui
find /tmp/nd-ui -name "*.tmpl" | while read f; do mv "$f" "${f%.tmpl}"; done
find /tmp/nd-ui -type f | while read f; do sed -i "s/{{DOMAIN}}/widget/g; s/{{HTTP_PORT}}/3400/g" "$f"; done
node -e "JSON.parse(require('fs').readFileSync('/tmp/nd-ui/proxy.conf.json','utf8'))" && echo "proxy JSON OK"
grep -q '```' .claude/skills/new-domain/templates/ui/cors.snippet.md && echo "cors snippet fenced OK"
```
Expected: `proxy JSON OK` + `cors snippet fenced OK`.

- [ ] **Step 4: Commit**

```bash
cd D:/development/projects/de-braighter
git add .claude/skills/new-domain/templates/ui .claude/skills/new-domain/SKILL.md
git commit -m "feat(new-domain): UI tier templates + SKILL.md Step 5

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: WORKBENCH-REGISTRATION.md + SKILL.md Steps 6–7 + tail

**Files:**
- Create: `de-braighter/.claude/skills/new-domain/WORKBENCH-REGISTRATION.md`
- Modify: `de-braighter/.claude/skills/new-domain/SKILL.md`

- [ ] **Step 1: Write `WORKBENCH-REGISTRATION.md`**

````markdown
# Workbench registration

Two edits in the **workbench** repo (`de-braighter/`), on a branch, PR-gated. NEVER
`git add -A` in the workbench — explicit paths only (it carries unrelated untracked WIP).

## 1. `repos.yaml` — add under `domains:`
```yaml
    - {{DOMAIN}}         # {{PURPOSE}}
```

## 2. `projects/{{DOMAIN}}/project.yaml`
```yaml
# {{DOMAIN}} — {{PURPOSE}}
# Form: pack-on-platform (ADR-027), zero kernel change (ADR-176).
name: {{DOMAIN}}
domain: {{DOMAIN}}
status: bootstrapping
repo: github.com/de-braighter/{{DOMAIN}}
local: domains/{{DOMAIN}}/
enabled:
  agents:
    suggested: [designer, substrate-architect, substrate-coder-pro, implementer, reviewer, charter-checker, qa-engineer, local-ci, prisma-pro, test-pro]
  skills:
    suggested: [architecture-concierge, diff-refactor-engine, md-quality-review]
```

## 3. Commit + PR
```bash
git add repos.yaml projects/{{DOMAIN}}/project.yaml
git status --short    # MUST show ONLY those two; everything else stays ?? untracked
git commit -m "chore(manifest): register {{DOMAIN}} domain"
git push -u origin chore/register-{{DOMAIN}}-domain
gh pr create --title "chore: register {{DOMAIN}} domain" --body "…"
```
````

- [ ] **Step 2: Append Steps 6–7 + the run-recipe/gotcha-index tail to SKILL.md**

````markdown
### Step 6 — Workbench registration
Follow `WORKBENCH-REGISTRATION.md`: branch the workbench, add `{{DOMAIN}}` to `repos.yaml`
`domains:`, create `projects/{{DOMAIN}}/project.yaml`, commit (explicit paths only), open a PR.

### Step 7 — GitHub remote (confirm-with-user)
**Outward-facing — confirm with the user first.** Then:
```bash
cd domains/{{DOMAIN}}
gh repo create de-braighter/{{DOMAIN}} --private --source=. --remote=origin --push
```
Open the domain PR(s) for the scaffold and run the devloop twin ritual (drain → backfill →
reconcile) after each merge.

## Run recipe & gotcha index
- **Start the api compiled:** `pnpm run build && node dist/main.js` (NOT `tsx/esm` — no
  reflect-metadata → broken DI).
- **DB:** `docker compose up -d {{DOMAIN}}-db` → `pnpm run db:setup` → (`pnpm run db:seed` if
  inference). Needs `SUBSTRATE_APP_DATABASE_URL` + `SUBSTRATE_RLS_ENABLED=true`.
- **Auth headers** (guard-protected routes / dev proxy): `x-tenant-id` = the TENANT_ID
  (`10000000-0000-4000-8000-000000000001`), NOT the tenant_pack_id (`…-4001-…`); `x-pack-id:
  {{DOMAIN}}`; `x-user-id` = a UUID.
- **UI gate:** UI `test` script MUST be `ng test --watch=false --browsers=ChromeHeadless` or
  `pnpm -r run test` hangs.
- Full catalog: see the **markets-domain-arc** memory and `domains/markets/` itself (the
  reference run this skill was extracted from).
````

- [ ] **Step 3: Validate the cross-references resolve**

```bash
cd D:/development/projects/de-braighter
test -f .claude/skills/new-domain/WORKBENCH-REGISTRATION.md && echo "registration doc exists"
grep -q "### Step 7 — GitHub remote" .claude/skills/new-domain/SKILL.md && grep -q "Run recipe & gotcha index" .claude/skills/new-domain/SKILL.md && echo "steps 6-7 + tail present"
```
Expected: `registration doc exists` + `steps 6-7 + tail present`.

- [ ] **Step 4: Commit**

```bash
cd D:/development/projects/de-braighter
git add .claude/skills/new-domain/WORKBENCH-REGISTRATION.md .claude/skills/new-domain/SKILL.md
git commit -m "feat(new-domain): workbench registration doc + SKILL.md Steps 6-7 + run-recipe tail

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Full structural validation + PR

**Files:** none (validation + PR).

- [ ] **Step 1: Full all-tier substitution dry-run**

```bash
cd D:/development/projects/de-braighter
rm -rf /tmp/nd-all && cp -r .claude/skills/new-domain/templates /tmp/nd-all
find /tmp/nd-all -name "*.tmpl" | while read f; do mv "$f" "${f%.tmpl}"; done
find /tmp/nd-all -type f | while read f; do sed -i "s/{{DOMAIN}}/widget/g; s/{{DOMAIN_PASCAL}}/Widget/g; s/{{HTTP_PORT}}/3400/g; s/{{PG_PORT}}/5465/g; s/{{PURPOSE}}/A test domain/g" "$f"; done
echo "=== any stray tokens? (should be only {{PURPOSE}}-free + {{DOMAIN_PASCAL_UPPER}} which is hand-substituted) ==="
grep -rn "{{" /tmp/nd-all || echo "NO STRAY TOKENS"
echo "=== every json parses ==="
find /tmp/nd-all -name "*.json" | while read f; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BAD $f"; done; echo "json check done"
```
Expected: the only remaining `{{` is `{{DOMAIN_PASCAL_UPPER}}` in `.env.example` (documented as hand-substituted); every `.json` parses (no `BAD`).

- [ ] **Step 2: Frontmatter + structure final check**

```bash
cd D:/development/projects/de-braighter
node -e "const fs=require('fs');const t=fs.readFileSync('.claude/skills/new-domain/SKILL.md','utf8');const m=t.match(/^---\n([\s\S]*?)\n---/);if(!m)throw 'no fm';['name:','description:','allowed-tools:','tags:'].forEach(k=>{if(!m[1].includes(k))throw 'missing '+k});['Step 0','Step 1','Step 2','Step 3','Step 4','Step 5','Step 6','Step 7','Run recipe'].forEach(s=>{if(!t.includes(s))throw 'missing '+s});console.log('SKILL.md complete');"
ls .claude/skills/new-domain/templates/{foundation,db,inference,ui} >/dev/null && echo "all 4 tiers present"
```
Expected: `SKILL.md complete` + `all 4 tiers present`.

- [ ] **Step 3: Confirm only intended files staged (workbench WIP hygiene)**

```bash
cd D:/development/projects/de-braighter
git status --short
```
Expected: only `.claude/skills/new-domain/**` (committed across Tasks 1–7) — everything else stays `??` untracked. Working tree clean on the branch.

- [ ] **Step 4: Push + PR**

```bash
cd D:/development/projects/de-braighter
git push -u origin feat/new-domain-skill
gh pr create --title "feat: /new-domain scaffolder skill (extracted from the markets reference run)" --body "$(cat <<'EOF'
Adds the `new-domain` skill — a tiered scaffolder for new substrate domains, extracted from the shipped markets reference run (Phase 1/2/3).

- SKILL.md: 8-step Process (intake → foundation → DB → inference → UI → registration → remote), with the verified substrate-consumer gotchas as inline callouts per tier
- templates/{foundation,db,inference,ui}/: inert `.tmpl` + `{{TOKEN}}` template files lifted from domains/markets, domain-specifics reduced to EXAMPLE stubs
- WORKBENCH-REGISTRATION.md: the repos.yaml + project.yaml registration

Validation: frontmatter parses; all-tier substitution dry-run produces valid JSON with no stray tokens; all 4 tiers present. (Full domain run is the skill's own job when invoked, not this PR.)

Producer: orchestrator/claude-sonnet-4-6 [brainstorming, writing-plans, subagent-driven-development]
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --head feat/new-domain-skill --base main
```

---

## Self-Review

**Spec coverage:**
- Skill at `.claude/skills/new-domain/`, name `new-domain`, frontmatter → Task 1 ✓
- Tiered (foundation always; DB/inference/UI optional) → Tasks 2–6 ✓
- Interactive intake via AskUserQuestion (name, purpose, ports, tiers) → Task 1 SKILL Step 1 ✓
- `templates/` dir delivery, `.tmpl` suffix + `{{TOKEN}}` substitution → all template tasks ✓
- Gotchas as inline callouts per tier → Tasks 3 (foundation start), 4 (DB), 5 (inference), 6 (UI) ✓
- Confirm-with-user GitHub remote → Task 7 SKILL Step 7 ✓
- Run-recipe & gotcha index tail → Task 7 ✓
- WORKBENCH-REGISTRATION.md → Task 7 ✓
- No build code (markdown + inert templates; validation via `node -e`, not committed) → all ✓
- "Does NOT" boundary (no feature design / conjugate choice / kernel promotion) → Task 1 SKILL body ✓

**Placeholder scan:** The `{{TOKEN}}` placeholders are the intended substitution mechanism, not gaps. `{{DOMAIN_PASCAL_UPPER}}` is explicitly documented as hand-substituted (env-var prefix). No TBD/TODO.

**Consistency:** token set (`{{DOMAIN}}`/`{{DOMAIN_PASCAL}}`/`{{HTTP_PORT}}`/`{{PG_PORT}}`/`{{PURPOSE}}`) is identical in the spec, the SKILL Template-mechanics table, and every template task. Lib/app dir renames (`spine`→`{{DOMAIN}}-spine`, `pack`→`{{DOMAIN}}-pack`, `api`→`{{DOMAIN}}-api`) are consistent across Task 2 (template layout) and Task 3 (SKILL Step 2 rename instruction). The `start` script (`node dist/main.js`) + its gotcha callout are consistent between Task 2 (template) and Task 3 (SKILL Step 2).
