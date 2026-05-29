---
name: init-workbench
description: Use when setting up the de-braighter cluster on a new machine or fresh clone — the sibling layer/domain repos under layers/ and domains/ are missing, or their dependencies, the shared dev-Docker stack, or the domain databases aren't provisioned yet.
allowed-tools: Read, Bash, Glob, Grep, AskUserQuestion, TodoWrite
tags: [tooling]
---

# Init Workbench

Bootstrap the local de-braighter cluster. Run from the cluster root (`de-braighter/`, this
workbench repo's working tree). The root is already cloned — this skill provisions everything
*around* it: the sibling repos that live under `layers/` and `domains/` (each its own git repo,
gitignored at the root), their dependencies, the shared dev-Docker stack, and the domain databases.

There is **no skill-sync step** — `.claude/` is canonical at the cluster root (the old fabricir
skill-sync is retired).

## Prerequisites

- Git with access to the `de-braighter` GitHub org (same SSH host-alias / HTTPS auth as this repo's `origin`)
- Node.js + the package manager each repo uses (npm or pnpm — detect per repo via its lockfile)
- Docker Desktop running
- The shared dev-Docker stack available per `layers/platform/docs/docker-infrastructure.md`

## Process

Track each step with TodoWrite.

### Step 1 — Read the cluster manifest

Read `repos.yaml` at the cluster root. It groups the sibling repos:

```yaml
repos:
  layers:  [substrate, design-system, specs, platform, foundation]
  domains: [exercir, conservation, vector, devloop]
```

`layers/*` clone into `layers/<name>`; `domains/*` clone into `domains/<name>`.

### Step 2 — Determine the clone-URL base

Read the workbench's own remote and reuse its protocol, host, and org:

```bash
git remote get-url origin
```

- `git@github.com:de-braighter/workbench.git` → base `git@github.com:de-braighter/`
- `https://github.com/de-braighter/workbench.git` → base `https://github.com/de-braighter/`

Reuse the exact host — including any SSH host-alias (e.g. `github.com-de-braighter`) — for the child clones.

### Step 3 — Clone the sibling repos

For each repo in the manifest:

1. If the target dir already has a `.git/`, **skip** (never overwrite).
2. Otherwise clone into its cluster dir:

```bash
git clone {base}<name>.git layers/<name>     # layers
git clone {base}<name>.git domains/<name>    # domains
```

Report each result (cloned / skipped / error).

### Step 4 — Install dependencies

For each cloned repo with a `package.json`, install with the manager its lockfile implies
(`pnpm-lock.yaml` → `pnpm install`; `package-lock.json` → `npm install`):

```bash
( cd <repo-dir> && pnpm install )   # or npm install
```

If a repo's `package.json` defines a `build:themes` (or similar prebuild) script, run it.

### Step 5 — Shared Docker stack

Ask the user: "Start the shared dev-Docker infrastructure (PostgreSQL, etc.)?"

The stack is **not** in the cluster — it lives in the `fabricir` repo (`workbench-next/docker/`),
shared across all local projects, with always-on PostgreSQL on `:5432` and init-scripts that
auto-create each project's database. Start it per the authoritative runbook:

```
layers/platform/docs/docker-infrastructure.md
```

Follow that doc's `docker compose` invocation (add profiles like `pgadmin` / `redis` only if asked).
Then confirm Postgres is ready:

```bash
docker exec localdev-postgres pg_isready -U postgres
```

### Step 6 — Domain databases

If Docker is up, for each **domain** repo that has `prisma/schema.prisma` (e.g. `domains/exercir`):

```bash
( cd domains/<name> && npx prisma migrate deploy && npx prisma db seed )
```

Use `migrate deploy` only — never `migrate reset` (destructive).

### Step 7 — Verify

For a representative repo with an Nx build target (e.g. `domains/exercir`, `layers/substrate`),
confirm the wiring:

```bash
( cd <repo-dir> && npx nx build )
```

### Step 8 — Summary

Print a table — per repo: clone (cloned / skipped / error), install (ok / failed / n-a),
DB migrate+seed (ok / skipped / n-a) — plus Docker (started / skipped) and the verify build
(ok / failed). List any errors with manual-fix guidance.

## Error handling

- Don't abort on a single failure — continue and collect errors for the summary.
- If a repo fails to clone, skip its downstream steps (install, migrate, build).
- If Docker isn't running, skip Steps 5–6 and note it.

## Safeguards

- Never delete or overwrite an existing repo directory (skip when `.git/` is present).
- Never run `prisma migrate reset` — only `migrate deploy`.
- Ask before starting Docker.
- Don't clone the workbench itself — you're running inside it.
