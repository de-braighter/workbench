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
