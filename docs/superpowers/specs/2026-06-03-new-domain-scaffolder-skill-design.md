---
title: "/new-domain scaffolder skill — design"
status: superseded
superseded-by: .claude/skills/new-domain/SKILL.md
kind: technical-design
created: 2026-06-03
author: stibe
home: de-braighter/.claude/skills/new-domain
relates-to:
  - docs/superpowers/specs/2026-06-03-markets-external-source-integration-design.md
  - docs/superpowers/specs/2026-06-03-markets-phase2-spine-ingestion-design.md
  - docs/superpowers/specs/2026-06-03-markets-phase3-inference-readout-design.md
  - layers/specs/adr/adr-027-pack-architecture.md
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
---

# `/new-domain` scaffolder skill

> **⚠️ SUPERSEDED — STALE API.** This design captures the 1.0-era substrate API
> (`kind:'person'` subjects, 4-arg `InferenceBackboneRouter`, `^0.14`/`^0.19` pins).
> The shipped skill at `.claude/skills/new-domain/SKILL.md` is the authoritative,
> 1.2.0-current version (workbench#117 / PR #118). Do NOT follow API details here.

> The markets domain (Phase 1/2/3, shipped 2026-06-03) was the deliberate **reference
> run** for this skill. This extracts that run into a reusable, tiered scaffolder so a
> future session can stand up a new substrate domain in minutes — building, testing,
> registered — and carry the hard-won substrate-consumer gotchas forward instead of
> re-discovering them.

## Purpose

A markdown-instruction skill at `de-braighter/.claude/skills/new-domain/` that scaffolds a
brand-new substrate domain in the cluster. It produces a **building, testing, registered,
empty-but-real** pnpm-workspace domain (reusable spine lib + pack lib + NestJS api with
`/health`), with **optional tiers** for DB persistence, inference backbone, and an Angular UI.
Pack-on-platform (ADR-027), zero kernel change (ADR-176).

Invoked as `/new-domain` (a Skill-tool skill named `new-domain`, consistent with the 38
existing cluster skills).

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Tiered scope** (C): foundation always; DB / inference / UI optional | Foundation is identical across domains; DB+inference+UI are genuinely domain-specific. A read-only or compute-only domain needs just the foundation. Markets needed all three. |
| D2 | **Interactive intake** (A) via `AskUserQuestion` | Matches the cluster-skill idiom (`init-workbench`) and the founder-decision style. Port-collision-avoidance and tier selection are explicit prompts. |
| D3 | **Markdown-instruction skill, no build code** | Workbench is declarative-content-only. The agent follows steps + copies templates; no committed generator script. |
| D4 | **`templates/` dir delivery** (B), not inline | The workbench already has a root `templates/` (adr/concept/pr); template files are inert (copied *out*, never built in the workbench), real, diffable, copy-paste-verifiable. Keeps SKILL.md short. |
| D5 | **GitHub remote = confirm-with-user** | Outward-facing; the markets Task-7 pattern. The local repo + workbench registration complete without a remote. |
| D6 | **Gotchas captured as inline callouts per tier** | The verified substrate-consumer footguns live next to the template that triggers them, so they can't be missed. |

## Skill shape

```
de-braighter/.claude/skills/new-domain/
  SKILL.md
  templates/
    foundation/      ← always copied
      package.json.tmpl   pnpm-workspace.yaml   tsconfig.base.json.tmpl
      npmrc.tmpl   gitignore.tmpl   README.md.tmpl
      libs/spine/{package.json.tmpl, tsconfig.json.tmpl, vitest.config.ts, src/*}
      libs/pack/{package.json.tmpl, tsconfig.json.tmpl, vitest.config.ts, src/*}
      apps/api/{package.json.tmpl, tsconfig.json.tmpl, vitest.config.ts, src/*}
    db/              ← copied only if DB tier selected
      docker-compose.yml.tmpl   .env.example.tmpl
      tools/db/{env.mjs, setup.mjs, seed.mjs}
    inference/       ← copied only if inference tier selected
      inference-catalog.ts.tmpl   readout.service.ts.tmpl   readout.controller.ts.tmpl
      app-module-providers.snippet.md   (the 5-provider chain)
    ui/              ← copied only if UI tier selected
      proxy.conf.json.tmpl   asset-card/*   styles+tokens
  WORKBENCH-REGISTRATION.md  (repos.yaml + projects/<name>/project.yaml templates)
```

### Frontmatter

```yaml
---
name: new-domain
description: Use when standing up a brand-new substrate domain in the de-braighter cluster — scaffold a building, testing, registered pnpm-workspace domain (reusable spine lib + pack lib + NestJS api), optionally with the DB-persistence, inference-backbone, and Angular-UI tiers. Codifies the markets reference run.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, TodoWrite
tags: [tooling, scaffolding]
---
```

The body opens like `init-workbench`: run from the cluster root, what it produces, the
ADR-027/176 posture, and a pointer to the markets reference run + its memory.

## Template conventions

1. **`.tmpl` suffix** on any file tooling might pick up as live config
   (`package.json.tmpl`, `tsconfig.base.json.tmpl`, `angular.json.tmpl`). The skill strips
   `.tmpl` on copy. Inert files (`.mjs`, `.ts`, `.css`) keep plain names.
2. **Placeholder tokens** the agent substitutes on copy:
   - `{{DOMAIN}}` — kebab name (repo `de-braighter/{{DOMAIN}}`, `domains/{{DOMAIN}}/`, scope `@de-braighter/{{DOMAIN}}-*`)
   - `{{DOMAIN_PASCAL}}` — PascalCase (class names)
   - `{{HTTP_PORT}}` / `{{PG_PORT}}` — chosen ports
   - `{{PURPOSE}}` — one-line description (README, project.yaml, package descriptions)

## Process (SKILL.md body)

### Step 0 — Preconditions
Run from the cluster root. Confirm `de-braighter/` is the working tree (the `.claude/` host).

### Step 1 — Interactive intake (`AskUserQuestion`)
1. **Domain name** (kebab).
2. **One-line purpose**.
3. **Port pair** — grep `repos.yaml` + `domains/*/docker-compose.yml` for taken ports;
   **suggest the next free pair** (current max markets 3300/5455 → suggest 3400/5465);
   founder overrides. HTTP + Postgres.
4. **Tiers** (multi-select): DB persistence · inference backbone (notes DB prerequisite) ·
   Angular UI. Foundation is implied.

Record answers; drive the rest with TodoWrite (one task group per selected tier).

### Step 2 — Foundation tier (always)
Mirrors markets Phase 1, parameterized:
- `mkdir domains/{{DOMAIN}}` + `git init -b main`
- Copy `templates/foundation/**`, strip `.tmpl`, substitute tokens
- `pnpm install`; commit the workspace root
- `libs/{{DOMAIN}}-spine` — reusable capability lib + one locked contract + TDD smoke test
- `libs/{{DOMAIN}}-pack` — pack skeleton (`PACK_ID`, `constants.ts`) consuming the spine
- `apps/{{DOMAIN}}-api` — NestJS host, `GET /health`, live-verified (`pnpm run build && node dist/main.js` — **NOT** `tsx/esm`, which doesn't emit reflect-metadata)
- `pnpm run ci:local` green (build + typecheck + test)

### Step 3 — DB tier (if selected)
Copy `templates/db/**`. Callouts threaded inline:
- `db:setup` runs `app-roles` / `core-schema` / `kernel-event-log` (+ `kernel-plan-tree` if
  inference) from `@de-braighter/substrate-runtime/sql` via `prisma db execute`
- `SUBSTRATE_APP_DATABASE_URL` fail-fast guard in AppModule; `SUBSTRATE_RLS_ENABLED=true`
- `SubstrateModule.forRoot({ prismaClient: appRoleClient, … })` + an **explicit**
  `{ provide: DOMAIN_EVENT_PUBLISHER, useValue: new PrismaOutboxWriter() }` (not auto-bound)
- `GucPrismaRunner(appRoleClient)` value provider; writes via
  `runner.run(tenantPackId, tx => publisher.publishAll(envelopes, tx))`
- `kernel.plan_node` (if inference): column is `kind` (not `type`), root needs
  `tree_root_id = id`, and `title` + `created_by` are NOT NULL (no default) → seed sentinels
- `DomainEventEnvelope` / `DOMAIN_EVENT_PUBLISHER` from `@de-braighter/substrate-contracts/events`

### Step 4 — Inference tier (if selected; DB prerequisite)
Copy `templates/inference/**`. Callouts:
- `asJsonPath()` returns `Result<JsonPath,…>` → wrap with `requireJsonPath()` (throw on `!ok`)
- inference `Result` shape is `{ok, value, error}` (NOT fp-ts `{_tag, right, left}`)
- the **5-provider chain**: `INFERENCE_CATALOG` → `EVIDENCE_REPOSITORY`
  (`PrismaEvidenceLogRepository(runner, catalog)`) → `NUMPYRO_SIDECAR` (null) →
  `MEMBER_RESOLUTION_PORT` (no-op throw) → `INFERENCE_BACKBONE` (`InferenceBackboneRouter`).
  `INFERENCE_BACKBONE`/`NUMPYRO_SIDECAR` from `…/inference`; `MEMBER_RESOLUTION_PORT` from contracts root
- Normal-Normal fast-path **rejects non-`person` subjects** → represent domain entities as
  `{ kind: 'person', id: <UUID> }` (the backbone only uses `subject.id` for the
  `aggregate_id` filter)
- `buildCatalog()` lives in `apps/{{DOMAIN}}-api/src/config/` — the **library must not depend
  on substrate-runtime** (`InMemoryInferenceCatalog` is a runtime impl)
- `@Inject(Token)` on constructor params injected by class type (vitest/esbuild emits no
  decorator metadata)
- `PackManifest.key` (not `.packId`) in contracts 0.14.0

### Step 5 — UI tier (if selected)
Copy `templates/ui/**` + scaffold Angular CLI standalone. Callouts:
- **`ng test --watch=false --browsers=ChromeHeadless`** — the scaffolded `ng test` defaults
  to watch + visible browser, hanging `pnpm -r run test` once the app joins `apps/*`
- `app.enableCors({ origin: 'http://localhost:<ui-port>' })` + `proxy.conf.json` injecting the
  dev tenant headers (`x-tenant-id` = the TENANT_ID not tenant_pack_id; `x-user-id` must be a UUID)
- polling: `catchError(() => of(null))` inside `switchMap` to keep the stream alive on HTTP error
- `[ngClass]` (not `[class]`) for additive classes
- Angular version vs Node constraint (use the latest Angular the installed Node supports)

### Step 6 — Workbench registration
Per `WORKBENCH-REGISTRATION.md`: branch the workbench, add `{{DOMAIN}}` to `repos.yaml`
`domains:`, create `projects/{{DOMAIN}}/project.yaml`, commit, open PR. (Never `git add -A`
in the workbench — explicit paths only.)

### Step 7 — GitHub remote (confirm-with-user)
**Outward-facing — confirm first.** `gh repo create de-braighter/{{DOMAIN}} --private
--source=. --remote=origin --push`, then open the domain PR + run the twin ritual.

### Run recipe & gotcha index
A consolidated tail section: the markets run-recipe (`node dist/main.js` not tsx; auth
headers; `x-tenant-id` = tenant id, not tenant_pack_id; `db:setup` + `db:seed` order) and a
one-line link to the markets-domain-arc memory for the full catalog.

## What this skill does NOT do
- Design the domain's actual features — that's a per-domain brainstorm after the scaffold
- Choose the conjugate family, observation shape, or indicator semantics (domain-specific)
- Promote anything into the kernel (ADR-176 — new domains are pack-on-platform)
- Publish substrate packages (consumes the published `@de-braighter/*`)

## Success criteria
- A founder runs `/new-domain`, answers ~4 questions, and gets a building/testing/registered
  domain with the selected tiers, `ci:local` green, `/health` (and `/readout` if inference)
  live-verifiable.
- The substrate-consumer gotchas are surfaced inline — not re-discovered.
- The skill itself contains no build code; templates are inert declarative content.
