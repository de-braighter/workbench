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
tier and the markets-domain-arc memory for the full catalog.

## What this produces vs what it does NOT

PRODUCES: workspace structure, substrate wiring, `GET /health` (+ `GET /readout` if
inference), green `ci:local`, workbench registration. Does NOT design your domain's features,
choose the conjugate family / observation shape, promote anything into the kernel, or publish
substrate packages. After scaffolding, brainstorm the actual domain features as a separate cycle.

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

### Step 2 — Foundation tier (always)
1. `mkdir domains/{{DOMAIN}}` then `cd` in and `git init -b main`.
2. Copy `templates/foundation/**` into `domains/{{DOMAIN}}/`, rename `*.tmpl` (and
   `npmrc`/`gitignore`/`README.md.tmpl` dotfiles → `.npmrc`/`.gitignore`/`README.md`),
   substitute tokens (see Template mechanics).
3. Rename the lib/app dirs: `libs/spine` → `libs/{{DOMAIN}}-spine`, `libs/pack` →
   `libs/{{DOMAIN}}-pack`, `apps/api` → `apps/{{DOMAIN}}-api`.
4. `pnpm install` (resolves root devDeps + the workspace libs).
5. The shipped placeholder smoke tests are already green; run `pnpm run ci:local` — build +
   typecheck + test must pass.
6. Live-verify the api:
   ```bash
   cd apps/{{DOMAIN}}-api && pnpm run build && node dist/main.js &
   sleep 4 && curl -s http://localhost:{{HTTP_PORT}}/health   # → {"status":"ok","pack":"{{DOMAIN}}"}
   ```
   **GOTCHA — use `node dist/main.js`, NOT `node --import tsx src/main.ts`.** tsx/esbuild does
   not emit `reflect-metadata`, so NestJS DI silently fails (injected services become
   `undefined`). The `start` script already points at the compiled output.
7. Commit each package as you go (workspace root → spine → pack → api). Commit `pnpm-lock.yaml`.

### Step 3 — DB persistence tier (if selected)
1. Copy `templates/db/**` into the domain (`docker-compose.yml`, `.env.example`, `tools/db/*`).
   Rename `*.tmpl`, substitute tokens, and replace `{{DOMAIN_PASCAL_UPPER}}` with the
   upper-snake env prefix (e.g. `LOGISTICS`). `cp .env.example .env`.
2. Add the DB scripts to the root `package.json`: `db:start` (`docker compose up -d
   {{DOMAIN}}-db`), `db:setup` (`node tools/db/setup.mjs`), `db:seed` (`node tools/db/seed.mjs`),
   `ci:local:db` (`pnpm run db:start && pnpm run db:setup && [pnpm run db:seed &&] pnpm run ci:local`).
3. Copy `templates/db/config/tenants.ts.tmpl` + `templates/db/config/manifest.ts.tmpl` into
   `apps/{{DOMAIN}}-api/src/config/`, rename (strip `.tmpl`), substitute tokens including
   `{{DOMAIN_PASCAL_UPPER}}`.
4. Add deps to `apps/{{DOMAIN}}-api`: `@de-braighter/substrate-contracts@^0.14.0`,
   `@de-braighter/substrate-runtime@^0.19.0`, `@prisma/client@^6`, `prisma@^6` (dev). Add a
   `prisma/schema.prisma` with the vendored `EventLog`+`Outbox` kernel models
   (`@@schema("kernel")`, multi-schema datasource) — lift from
   `domains/markets/apps/markets-api/prisma/schema.prisma`.
5. Splice `templates/db/app-module-db.snippet.md` into `app.module.ts`.
6. `docker compose up -d {{DOMAIN}}-db && pnpm run db:setup`, then live-verify writes.

**GOTCHAS (DB):**
- `db:setup` runs `app-roles` / `core-schema` / `kernel-event-log` (+ `kernel-plan-tree` if
  inference) from `@de-braighter/substrate-runtime/sql` via `prisma db execute`.
- `{{DOMAIN_PASCAL_UPPER}}_TENANTS` / `{{DOMAIN_PASCAL_UPPER}}_MANIFEST` must exist in
  `src/config/` **before** splicing the snippet — the snippet imports them; it does not create
  them. (Step 3 above — copy + rename `config/*.ts.tmpl` first.)
- AppModule needs a fail-fast guard on `SUBSTRATE_APP_DATABASE_URL` (else PrismaClient falls
  back to the admin URL and bypasses RLS), and `SUBSTRATE_RLS_ENABLED=true` to activate the
  GUC in `GucPrismaRunner`.
- `SubstrateModule.forRoot({ prismaClient: appRoleClient, … })` does NOT auto-bind the
  publisher — add an explicit `{ provide: DOMAIN_EVENT_PUBLISHER, useValue: new PrismaOutboxWriter() }`.
- `DomainEventEnvelope` / `DOMAIN_EVENT_PUBLISHER` import from
  `@de-braighter/substrate-contracts/events` (re-exported from substrate-runtime root).
- `kernel.plan_node` (inference): column is `kind` (not `type`), root needs `tree_root_id = id`,
  and `title` + `created_by` are NOT NULL (no default) → use sentinels in seed.sql.

### Step 4 — Inference backbone tier (if selected; requires DB)
1. Copy `templates/inference/**`. Put `inference-catalog.example.ts` under
   `apps/{{DOMAIN}}-api/src/config/` and `readout.service.example.ts` +
   `readout.controller.ts` under `apps/{{DOMAIN}}-api/src/readout/`. Strip the `.example`
   suffix once you've replaced the EXAMPLE indicator/subject/projection with your domain's.
2. Ensure the DB tier is applied: `db:setup` must include the `kernel-plan-tree.sql` step and
   `db:seed` must seed the plan root (the DB tier ships both; `config/tenants.ts` exports the
   `_PLAN_ROOT_ID` the readout uses).
3. Splice `app-module-inference.snippet.md` into AppModule (the 5-provider chain), add
   `inferenceCatalog: build{{DOMAIN_PASCAL}}Catalog()` to `SubstrateModule.forRoot`, add
   `ReadoutController` to controllers + `ReadoutService` to providers.
4. Live-verify `GET /readout` after writing a few observation events.

**GOTCHAS (inference):**
- `asJsonPath()` returns `Result<JsonPath,…>`, not a string → wrap with `requireJsonPath()`
  (throw on `!ok`). The inference `Result` shape is `{ok, value, error}` (NOT fp-ts
  `{_tag,right,left}`).
- The 5-provider chain (all explicit — backbone is NOT auto-bound): `INFERENCE_CATALOG` →
  `EVIDENCE_REPOSITORY` (`new PrismaEvidenceLogRepository(runner, catalog)`) → `NUMPYRO_SIDECAR`
  (`null`) → `MEMBER_RESOLUTION_PORT` (no-op that throws) → `INFERENCE_BACKBONE`
  (`new InferenceBackboneRouter(catalog, evidence, sidecar, members)`).
  `INFERENCE_BACKBONE`/`NUMPYRO_SIDECAR` from `…/inference`; `MEMBER_RESOLUTION_PORT` from
  contracts root.
- The Normal-Normal fast-path **rejects non-`person` subjects** → represent domain entities as
  `{ kind: 'person', id: <UUID> }` (the backbone only uses `subject.id` for the `aggregate_id`
  filter against `kernel.event_log`).
- `build{{DOMAIN_PASCAL}}Catalog()` lives in `apps/{{DOMAIN}}-api/src/config/` — the **library
  must not depend on substrate-runtime** (`InMemoryInferenceCatalog` is a runtime impl).
- `@Inject(Token)` on constructor params injected by class type (vitest/esbuild emits no
  decorator metadata).
- `PackManifest.key` (not `.packId`) in contracts 0.14.0.
