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
inference), the born-with quality floor (lint audit set + knip + tier-parameterized
Stryker + coverage-wired vitest base + a11y battery template — see Step 2b), green
`ci:local`, workbench registration. Does NOT design your domain's features,
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
   typecheck + lint + test + knip report must pass (the quality floor ships with the
   foundation tier — see Step 2b).
6. Live-verify the api:
   ```bash
   cd apps/{{DOMAIN}}-api && pnpm run build && node dist/main.js &
   sleep 4 && curl -s http://localhost:{{HTTP_PORT}}/health   # → {"status":"ok","pack":"{{DOMAIN}}"}
   ```
   **GOTCHA — use `node dist/main.js`, NOT `node --import tsx src/main.ts`.** tsx/esbuild does
   not emit `reflect-metadata`, so NestJS DI silently fails (injected services become
   `undefined`). The `start` script already points at the compiled output.
7. Commit each package as you go (workspace root → spine → pack → api). Commit `pnpm-lock.yaml`.

### Step 2b — Quality floor (always; born with the foundation tier)

The foundation templates ship the deterministic quality floor (Foundry spec §5) — every
product is born with it. Each gate kills a named AI-harness failure mode:

| Gate | Kills | Where |
|---|---|---|
| ESLint audit set (`auditConfig`: switch-exhaustiveness, no default-masking on unions) | unmapped-error→500 | `eslint.config.mjs` |
| knip (dead exports / unused deps) | speculative generality (ADR-176) | `knip.ts` + `quality:knip` |
| Stryker mutation testing, tier thresholds | test-theater | `libs/*/stryker.config.mjs` + `quality:mutation` |
| test-kit vitest base (lcov coverage) | silent coverage erosion | `*/vitest.config.ts` |
| Non-superuser DB tests (`assertNonSuperuser`) | broken-but-passing RLS / isolation-untested | DB tier (Step 3 gotchas) |
| a11y battery template | inaccessible-by-default UI | UI tier (Step 5) |

After scaffolding:
1. **Set the mutation tier from the product charter** (`docs/foundry/<key>/charter.md`
   risk tier): edit each `libs/*/stryker.config.mjs` → `defineStrykerConfig({ tier: 't0'|'t1'|'t2' })`.
   t0 is report-only (`break: null`); t1 breaks under 60; t2 under 75. No charter
   (non-Foundry domain) → t0 until the owner decides.
2. `quality:knip` (strict) is the wave-time / `qualityObligations` gate; `ci:local` runs
   the report mode (`--no-exit-code`) so a fresh scaffold is never blocked by a config
   false-positive — triage findings, don't suppress them.
3. **DB tier:** any DB-backed spec's global setup MUST call `assertNonSuperuser` from
   `@de-braighter/test-kit` on the same connection the tests use — superusers bypass
   FORCE RLS, so a suite running as superuser proves nothing:

   ```ts
   import { assertNonSuperuser } from '@de-braighter/test-kit/pg-roles';
   await assertNonSuperuser((sql) => appPrisma.$queryRawUnsafe(sql));
   ```
4. **UI tier:** copy the a11y battery next to each page component (Step 5 item 6).

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
- `db:setup` runs all four SQL scripts — `app-roles` / `core-schema` / `kernel-event-log` /
  `kernel-plan-tree` — from `@de-braighter/substrate-runtime/sql` via `prisma db execute`.
  `kernel-plan-tree` is idempotent and harmless even without the inference tier (it's only
  *used* by inference, but always provisioned).
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
3. Splice `app-module-inference.snippet.md` into AppModule (the 5-provider chain — it
   registers `INFERENCE_CATALOG` as a provider; do NOT also pass `inferenceCatalog:` to
   `SubstrateModule.forRoot`, which would double-bind the catalog). Add `ReadoutController` to
   controllers + `ReadoutService` to providers.
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

### Step 5 — Angular UI tier (if selected)
1. Scaffold an Angular CLI standalone app at `apps/{{DOMAIN}}-ui` (use the latest Angular the
   installed Node supports — check `node --version` against the CLI's engine requirement):
   `ng new {{DOMAIN}}-ui --standalone --routing=false --style=css --skip-git --skip-install --no-interactive`
   (declines analytics + SSR).
2. Set the dev-server port + proxy in `angular.json` serve options: `"port": <ui-port>`,
   `"proxyConfig": "proxy.conf.json"`. Copy `templates/ui/proxy.conf.json` (tokenized; the
   tenant headers are required — see gotchas).
3. Copy `tokens.css` (imported from `styles.css`) + the EXAMPLE component templates; wire
   `provideHttpClient()` in `app.config.ts`. Splice `cors.snippet.md` into the api `main.ts`
   (substitute the UI port).
4. **Set the UI `package.json` test script to `ng test --watch=false --browsers=ChromeHeadless`
   BEFORE running any workspace gate** (see gotchas).
5. `pnpm install` at the root; `npx ng build`; live-verify the page in a browser.
6. Copy `templates/ui/a11y.spec.example.ts` to `apps/{{DOMAIN}}-ui/src/app/a11y.spec.ts`
   (adapt the component import if renamed) — the canonical a11y battery
   (player-surfaces patterns); it runs with `ng test` in the workspace gate. Copy it
   again next to every page component you add later.

**GOTCHAS (UI):**
- **The scaffolded `ng test` defaults to watch mode + a visible browser.** Once `apps/{{DOMAIN}}-ui`
  joins the `apps/*` glob, `pnpm -r run test` (the workspace `ci:local`) HANGS FOREVER. Fix the
  UI `test` script to `ng test --watch=false --browsers=ChromeHeadless` (exits clean) before
  the first gate run.
- Add the dev tenant headers to `proxy.conf.json` — the global `TenantPackContextGuard`
  requires `x-tenant-id` (the TENANT_ID `10000000-0000-4000-8000-000000000001`, NOT the
  tenant_pack_id `…-4001-…`), `x-pack-id`, `x-user-id` (must be a UUID). The proxy is dev-only.
- Keep polling alive on transient errors: `catchError(() => of(null))` INSIDE `switchMap`
  (a raw error terminates the RxJS stream permanently — polling would stop after one blip).
- `[ngClass]` (not `[class]`) for additive classes — `[class]="str"` replaces the static class.
- Angular version: the latest may require a newer Node than installed; drop to the latest
  Angular your Node supports (markets used Angular 19 on Node 22.14).

### Step 6 — Workbench registration
Follow `WORKBENCH-REGISTRATION.md`: branch the workbench, add `{{DOMAIN}}` to `repos.yaml`
`domains:`, create `projects/{{DOMAIN}}/project.yaml`, commit (explicit paths only — never
`git add -A` in the workbench), open a PR.

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
  reflect-metadata → broken NestJS DI).
- **DB:** `docker compose up -d {{DOMAIN}}-db` → `pnpm run db:setup` → (`pnpm run db:seed` if
  inference). Needs `SUBSTRATE_APP_DATABASE_URL` + `SUBSTRATE_RLS_ENABLED=true`.
- **Auth headers** (guard-protected routes / dev proxy): `x-tenant-id` = the TENANT_ID
  (`10000000-0000-4000-8000-000000000001`), NOT the tenant_pack_id (`…-4001-…`); `x-pack-id:
  {{DOMAIN}}`; `x-user-id` = a UUID.
- **UI gate:** the UI `test` script MUST be `ng test --watch=false --browsers=ChromeHeadless`
  or `pnpm -r run test` hangs.
- **Inference:** `asJsonPath()` returns a `Result`; the 5-provider chain is explicit;
  Normal-Normal rejects non-`person` subjects; the catalog builder lives in the api, not the lib.
- Full catalog: see the **markets-domain-arc** memory and `domains/markets/` itself (the
  reference run this skill was extracted from).
