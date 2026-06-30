# Infomaniak Managed PostgreSQL (shared dev DB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⛔ This is a hybrid plan.** **Task 1 is committable IaC** authored + validated like normal code (no live resources, `-backend=false`). **Tasks 2–5 are ⛔ GATE live operations** against the founder's *real, paid* Infomaniak account (provision a managed DB, run psql/migrations, distribute creds). A worker MUST NOT run a ⛔ GATE task autonomously — author the commands, then **pause and have the founder run each gated step**, reconfirming immediately before. Real secrets (tfvars, tfstate, `.env`, `ca.pem`) are **never committed**.

**Goal:** Stand up one Infomaniak Managed PostgreSQL instance (Terraform in `layers/platform`) as a shared dev/staging database — provisioned, with the `exercir` database + RLS roles + migrations applied, reachable over TLS from several developer machines.

**Architecture:** A new `managed-postgres` Terraform module wraps the `infomaniak_dbaas` resource and is wired into the existing `envs/dev` root stack (same Infomaniak provider + S3 state backend as the k8s-cluster/s3-bucket modules). The instance exposes a public `host:port` gated by an IP allowlist (`allowed_cidrs`) with a CA cert for TLS. Per-database/role layout is created by **reusing exercir's own `db:setup:core` + `db:deploy` npm scripts** against the new instance — Terraform owns only the instance, not the schema/roles. The in-cluster Postgres StatefulSet stays untouched as a fallback; backend cutover + data migration are explicit **follow-ons, not in this plan**.

**Tech Stack:** OpenTofu ≥ 1.10, Infomaniak Terraform provider `~> 1.4` (resource `infomaniak_dbaas`), Infomaniak Managed PostgreSQL (DBaaS, launched Jan 2026), PostgreSQL 16, Prisma 6 (exercir), `psql`, SOPS/age (secrets).

## Global Constraints

_Every task's requirements implicitly include this section._

- **OpenTofu ≥ 1.10.0**; the `terraform {}` block name is preserved (OpenTofu reads it) — per ADR-139.
- **Infomaniak provider `~> 1.4`** (must include the `infomaniak_dbaas` resource; the envs currently pin `~> 1.3` — bump in Task 1).
- **Provider auth is via env vars**, never in code: `INFOMANIAK_TOKEN` (Manager PAT) for the Infomaniak provider; a sourced OpenRC file / `clouds.yaml` + `OS_CLOUD` for OpenStack.
- **Never commit secrets.** `terraform.tfvars`, `*.tfstate`, any `.env`, and `ca.pem` are gitignored / out-of-band. If a secret file is tracked, stop and report (per `layers/platform/CLAUDE.md`).
- **`allowed_cidrs` is NEVER empty** — an empty list blocks all access including your own (per the provider docs).
- **TLS:** dev connects `sslmode=verify-full` with the CA file (`PGSSLROOTCERT=ca.pem`); `require` is the only acceptable fallback.
- **No real PHI / production data** on this instance — it is dev/staging (charter §2 demo posture).
- **Prisma always uses the directory form** `--schema=./prisma` (file form silently drops pack models) — exercir's npm scripts already do this; don't bypass them.
- **`npm install` in `domains/exercir` needs `GITHUB_TOKEN`** (classic PAT, `read:packages`) for the `@de-braighter/*` GitHub Packages deps.
- **Vendor enums (`type`, `version`, `pack_name`, `region`) are confirmed at `tofu plan` time** against the founder's account — Task 2 surfaces valid values; do not assume.

---

### Task 1: `managed-postgres` Terraform module + `envs/dev` wiring

Authoring-only, committable, **no live resources**. Test is `tofu validate` with `-backend=false`.

**Files:**
- Create: `layers/platform/terraform/modules/managed-postgres/versions.tf`
- Create: `layers/platform/terraform/modules/managed-postgres/variables.tf`
- Create: `layers/platform/terraform/modules/managed-postgres/main.tf`
- Create: `layers/platform/terraform/modules/managed-postgres/outputs.tf`
- Modify: `layers/platform/terraform/envs/dev/versions.tf` (bump `infomaniak` to `~> 1.4`)
- Modify: `layers/platform/terraform/envs/dev/variables.tf` (add DB vars)
- Modify: `layers/platform/terraform/envs/dev/main.tf` (add `module "postgres"` + outputs)
- Modify: `layers/platform/terraform/envs/dev/terraform.tfvars.example` (add DB example values)

**Interfaces:**
- Consumes: existing `var.public_cloud_id`, `var.public_cloud_project_id` (ints, already declared in `envs/dev/variables.tf`).
- Produces (module outputs, consumed by Tasks 2–5): `module.postgres.host` (string), `.port` (string), `.user` (string), `.password` (string, sensitive), `.ca` (string), `.id` (int).

- [ ] **Step 1: Create the module's provider requirement**

`layers/platform/terraform/modules/managed-postgres/versions.tf`:

```hcl
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    infomaniak = {
      source  = "Infomaniak/infomaniak"
      version = "~> 1.4"
    }
  }
}
```

- [ ] **Step 2: Create the module variables**

`layers/platform/terraform/modules/managed-postgres/variables.tf`:

```hcl
variable "public_cloud_id" {
  type        = number
  description = "Infomaniak Public Cloud id (integer)."
}

variable "public_cloud_project_id" {
  type        = number
  description = "Infomaniak Public Cloud project id (integer)."
}

variable "name" {
  type        = string
  description = "DBaaS instance name shown in the Manager."
  default     = "exercir-shared-dev"
}

variable "pack_name" {
  type        = string
  description = "DBaaS pack (flavor). Smallest single-instance pack for dev. Confirm the exact name at `tofu plan` against your project."
}

variable "type" {
  type        = string
  description = "Database engine."
  default     = "postgresql"
}

variable "version" {
  type        = string
  description = "PostgreSQL version (match the in-cluster pg16, e.g. \"16\"). Confirm the exact string at `tofu plan`."
}

variable "region" {
  type        = string
  description = "DBaaS region, e.g. \"dc4-a\". Confirm via the Manager / `openstack region list`."
}

variable "allowed_cidrs" {
  type        = list(string)
  description = "Source CIDRs allowed to reach the DB (dev machines' public IPs + the cluster egress IP). NEVER empty."

  validation {
    condition     = length(var.allowed_cidrs) > 0
    error_message = "allowed_cidrs must be non-empty — an empty list blocks all access, including yours."
  }
}

variable "configuration" {
  type        = map(any)
  description = "Engine parameters (the resource requires >= 1). PostgreSQL params per the Infomaniak DBaaS configuration API."
  default     = { max_connections = 100 }
}
```

- [ ] **Step 3: Create the resource**

`layers/platform/terraform/modules/managed-postgres/main.tf`:

```hcl
# Infomaniak Managed PostgreSQL (DBaaS). Provisions the INSTANCE only — the
# exercir database, the non-superuser `app` role, RLS and migrations are
# created out-of-band by exercir's own `db:setup:core` + `db:deploy` scripts
# (see the plan). Schema reference:
# https://registry.terraform.io/providers/Infomaniak/infomaniak/latest/docs/resources/dbaas
resource "infomaniak_dbaas" "this" {
  public_cloud_id         = var.public_cloud_id
  public_cloud_project_id = var.public_cloud_project_id

  name      = var.name
  pack_name = var.pack_name
  type      = var.type
  version   = var.version
  region    = var.region

  allowed_cidrs = var.allowed_cidrs
  configuration = var.configuration
}
```

- [ ] **Step 4: Create the module outputs**

`layers/platform/terraform/modules/managed-postgres/outputs.tf`:

```hcl
output "id" {
  value = infomaniak_dbaas.this.id
}

output "host" {
  value = infomaniak_dbaas.this.host
}

output "port" {
  value = infomaniak_dbaas.this.port
}

output "user" {
  value = infomaniak_dbaas.this.user
}

output "password" {
  value     = infomaniak_dbaas.this.password
  sensitive = true
}

output "ca" {
  value = infomaniak_dbaas.this.ca
}
```

- [ ] **Step 5: Bump the env provider constraint**

In `layers/platform/terraform/envs/dev/versions.tf`, change the `infomaniak` block version from `~> 1.3` to:

```hcl
    infomaniak = {
      source  = "Infomaniak/infomaniak"
      version = "~> 1.4"
    }
```

(Leave the `openstack` block and `required_version` unchanged.)

- [ ] **Step 6: Add the DB variables to the env**

Append to `layers/platform/terraform/envs/dev/variables.tf`:

```hcl
variable "pg_pack_name" {
  type        = string
  description = "Smallest single-instance DBaaS pack for the shared dev Postgres."
}

variable "pg_version" {
  type        = string
  description = "PostgreSQL version for the shared dev DBaaS (e.g. \"16\")."
}

variable "pg_region" {
  type        = string
  description = "Region for the shared dev DBaaS (e.g. \"dc4-a\")."
}

variable "pg_allowed_cidrs" {
  type        = list(string)
  description = "Source CIDRs allowed to reach the shared dev Postgres (dev public IPs + cluster egress). NEVER empty."
}
```

- [ ] **Step 7: Wire the module + outputs into the env**

Add to `layers/platform/terraform/envs/dev/main.tf` (after the `module "ai"` block, before the `output` blocks):

```hcl
module "postgres" {
  source = "../../modules/managed-postgres"

  public_cloud_id         = var.public_cloud_id
  public_cloud_project_id = var.public_cloud_project_id

  name          = "exercir-shared-${local.env}"
  pack_name     = var.pg_pack_name
  version       = var.pg_version
  region        = var.pg_region
  allowed_cidrs = var.pg_allowed_cidrs
}
```

And add these outputs (next to the existing `output` blocks). The connection-detail outputs are read by the founder at apply; `password` is sensitive:

```hcl
output "pg_host" {
  value = module.postgres.host
}

output "pg_port" {
  value = module.postgres.port
}

output "pg_user" {
  value = module.postgres.user
}

output "pg_password" {
  value     = module.postgres.password
  sensitive = true
}

output "pg_ca" {
  value = module.postgres.ca
}
```

- [ ] **Step 8: Add example tfvars**

Append to `layers/platform/terraform/envs/dev/terraform.tfvars.example`:

```hcl
# --- Shared dev Managed PostgreSQL (infomaniak_dbaas) -------------------------
# Confirm pack/version/region against your project at `tofu plan`.
pg_pack_name = "REPLACE_ME"   # smallest single-instance pack
pg_version   = "16"
pg_region    = "dc4-a"

# Your dev machines' PUBLIC IPs (/32) + the cluster egress IP. NEVER empty.
pg_allowed_cidrs = ["198.51.100.10/32"]
```

- [ ] **Step 9: Format + validate (the test)**

Run from `layers/platform/terraform/envs/dev`:

```bash
tofu fmt -recursive ../../
tofu init -backend=false
tofu validate
```

Expected: `tofu fmt` leaves no diff; `tofu validate` prints `Success! The configuration is valid.` (init with `-backend=false` needs no S3 creds; it only installs providers — confirms `infomaniak ~> 1.4` resolves and `infomaniak_dbaas` is a known resource.)

- [ ] **Step 10: Commit**

```bash
git add layers/platform/terraform/modules/managed-postgres/ \
        layers/platform/terraform/envs/dev/versions.tf \
        layers/platform/terraform/envs/dev/variables.tf \
        layers/platform/terraform/envs/dev/main.tf \
        layers/platform/terraform/envs/dev/terraform.tfvars.example
git commit -m "feat(platform): managed-postgres module + envs/dev wiring (infomaniak_dbaas)"
```

> **PR note (platform is PR-gated):** push a branch and open a PR for this Terraform change; it does not create live resources, so it can be reviewed normally before the ⛔ GATE tasks run.

---

### Task 2: ⛔ GATE — Provision the instance (`tofu apply`)

**Live, paid, founder-run.** Reconfirm immediately before applying. No file commits (tfvars + state are gitignored).

**Interfaces:**
- Consumes: Task 1's module/outputs; `INFOMANIAK_TOKEN`; sourced OpenStack creds; the real `public_cloud_id` / `public_cloud_project_id`.
- Produces: a running instance + the captured connection details `host`, `port`, `user`, `password`, `ca` (used by Tasks 3–5).

- [ ] **Step 1: Fill real tfvars** (gitignored)

From `layers/platform/terraform/envs/dev`: `cp terraform.tfvars.example terraform.tfvars`, then set the real `public_cloud_id`, `public_cloud_project_id`, `ai_*` (already present), and the new `pg_*` values — including `pg_allowed_cidrs` with **your current public IP** (`curl -s https://ifconfig.me`) as `<ip>/32`.

- [ ] **Step 2: Init with the real backend + plan**

```bash
export INFOMANIAK_TOKEN=...        # Manager PAT
source ~/openrc.sh                 # or: export OS_CLOUD=... with clouds.yaml
tofu init                          # real S3 backend (exercir-tf-state-dev)
tofu plan -out tf.plan
```

Expected: a plan adding **one** `module.postgres.infomaniak_dbaas.this`. **If `pg_pack_name` / `pg_version` / `pg_region` / `type` are invalid, the plan/apply error lists the valid enums** — update `terraform.tfvars` (and the module `type` default if needed) and re-plan until clean.

- [ ] **Step 3: ⛔ GATE — Apply** (reconfirm with the founder — this creates a billable resource)

```bash
tofu apply tf.plan
```

Expected: apply completes; outputs `pg_host`, `pg_port`, `pg_user`, `pg_ca` print; `pg_password` shows `<sensitive>`.

- [ ] **Step 4: Capture connection details**

```bash
tofu output -raw pg_host
tofu output -raw pg_port
tofu output -raw pg_user
tofu output -raw pg_password      # sensitive — do not paste into logs/PRs
tofu output -raw pg_ca > ~/.config/exercir/managed-pg-ca.pem
```

Keep these in your password manager. Set, for the next tasks:

```bash
export PGHOST=$(tofu output -raw pg_host)
export PGPORT=$(tofu output -raw pg_port)
export PGUSER=$(tofu output -raw pg_user)
export PGPASSWORD=$(tofu output -raw pg_password)
export PGCA=~/.config/exercir/managed-pg-ca.pem
```

---

### Task 3: ⛔ GATE — pgvector availability gate

Determines topology before any migration (spec §7 / D5). **Run before Task 4** — exercir's migrations may require the `vector` extension, and `db:deploy` will fail if it's unavailable.

**Interfaces:**
- Consumes: `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGCA` from Task 2.
- Produces: a PASS/FAIL decision recorded in the PR/handoff.

- [ ] **Step 1: Does exercir actually require pgvector?**

```bash
grep -ri -E "extension|vector" domains/exercir/prisma/migrations || echo "NO vector usage in exercir migrations"
```

Note the result — it decides whether a FAIL blocks exercir at all.

- [ ] **Step 2: Probe the extension on the managed instance**

```bash
psql "host=$PGHOST port=$PGPORT user=$PGUSER dbname=postgres sslmode=verify-full sslrootcert=$PGCA" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" -c "DROP EXTENSION IF EXISTS vector;"
```

- [ ] **Step 3: Decide + record**

- **PASS** → proceed to Task 4; the `knowledge` DB may later join this instance.
- **FAIL + Step 1 showed NO vector usage** → proceed to Task 4 (exercir is unaffected); record that `knowledge`/vector workloads need the **dedicated pgvector instance** (D5) when they migrate later.
- **FAIL + Step 1 showed vector usage** → **STOP** the exercir cutover; the relational+vector split (D5) must be designed first. Escalate to the founder.

---

### Task 4: ⛔ GATE — Create `exercir` DB + roles + migrations

Reuses exercir's own scripts so RLS/role logic is not forked (spec §5 / D3). **Founder-run, on a machine in `pg_allowed_cidrs`.**

**Interfaces:**
- Consumes: Task 2 connection details; `GITHUB_TOKEN` (read:packages); the Task 3 decision.
- Produces: an `exercir` database with `core.*`/`kernel.*` + `football`/`kernel`/`kids_football` schemas, the non-superuser `app` role, applied migrations.

- [ ] **Step 1: Create the database** (the admin role connects to the default `postgres` db)

```bash
psql "host=$PGHOST port=$PGPORT user=$PGUSER dbname=postgres sslmode=verify-full sslrootcert=$PGCA" \
  -c "CREATE DATABASE exercir;"
```

Expected: `CREATE DATABASE`. **If the admin role may not create databases** (some DBaaS restrict to one DB), use the instance's default database name instead and substitute it for `exercir` below + in `var.name`-derived URLs.

- [ ] **Step 2: Write exercir's gitignored `.env`**

In `domains/exercir/.env` (copy from `.env.example`, gitignored) put the following **file content** — substitute the real host/port/password (URL-encode the password if it has special chars) and the absolute CA path. Quote the values (the `&` separating query params is literal in a dotenv value, but quoting avoids any tooling that re-parses it). Keep the `app:app` default from `app-roles.sql` for dev:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/exercir?sslmode=verify-full&sslrootcert=/abs/path/managed-pg-ca.pem"
SUBSTRATE_APP_DATABASE_URL="postgresql://app:app@HOST:PORT/exercir?sslmode=verify-full&sslrootcert=/abs/path/managed-pg-ca.pem"
GITHUB_TOKEN=ghp_...   # read:packages
```

- [ ] **Step 3: Install + provision core roles/schemas**

```bash
cd domains/exercir
npm install
npm run db:setup:core
```

Expected: each `prisma db execute` reports success — `app-roles.sql` creates the `app` role (NOSUPERUSER NOBYPASSRLS) and `core-schema.sql` + the three kernel SQL files create the `core.*`/`kernel.*` objects. **If `app-roles.sql` fails because the admin lacks `CREATEROLE`**, escalate (the DBaaS admin should have it; confirm in the Manager).

- [ ] **Step 4: Apply migrations**

```bash
npm run db:deploy
```

Expected: `prisma migrate deploy` applies all migrations; `football`, `kernel`, `kids_football` schemas are created. (If this fails on a missing `vector` extension, return to Task 3 — Step 1 mis-detected vector usage.)

- [ ] **Step 5: (Optional) Seed the football stub**

```bash
npm run db:seed:football
```

- [ ] **Step 6: Verify roles + schemas**

```bash
psql "host=$PGHOST port=$PGPORT user=$PGUSER dbname=exercir sslmode=verify-full sslrootcert=$PGCA" \
  -c "\du app" -c "\dn"
```

Expected: role `app` exists and is **not** Superuser; schemas include `core`, `kernel`, `football`, `kids_football`.

---

### Task 5: ⛔ GATE — Second-machine onboarding + acceptance

Delivers the original goal: another dev machine reaches the shared DB with **no kubeconfig/age key**. **Founder-run.**

**Interfaces:**
- Consumes: Task 2's `host/port/ca`, the running `exercir` DB from Task 4, the `terraform.tfvars` `pg_allowed_cidrs`.
- Produces: a verified working connection from a second machine; acceptance recorded.

- [ ] **Step 1: Allowlist the second machine**

On the second machine, get its public IP (`curl -s https://ifconfig.me`). Add `<ip>/32` to `pg_allowed_cidrs` in `envs/dev/terraform.tfvars`, then from `envs/dev`:

```bash
tofu plan -out tf.plan && tofu apply tf.plan
```

Expected: an in-place update of `infomaniak_dbaas.this` (allowlist changed), no replacement.

- [ ] **Step 2: Carry over the credentials (secure channel only)**

To the second machine, copy via a password manager / encrypted channel (NOT email/chat):
- `domains/exercir/.env` (the two DB URLs + `GITHUB_TOKEN`),
- the CA file `managed-pg-ca.pem` (update `sslrootcert=` to its path on that machine).

- [ ] **Step 3: Verify the connection from the second machine**

```bash
psql "host=$PGHOST port=$PGPORT user=app dbname=exercir sslmode=verify-full sslrootcert=/abs/path/managed-pg-ca.pem" \
  -c "\conninfo" -c "select count(*) from kernel.event_log;"
```

Expected: `\conninfo` reports an **SSL** connection; the query runs as `app` (subject to RLS).

- [ ] **Step 4: Acceptance checklist** (record in the handoff/PR)

- [ ] `tofu apply` created one `infomaniak_dbaas` instance; outputs captured.
- [ ] pgvector gate result recorded (PASS / FAIL+unaffected / FAIL+blocked).
- [ ] `exercir` DB exists; `app` role is non-superuser; migrations applied.
- [ ] A second machine connects over TLS with only `.env` + CA + an allowlist entry — no kubeconfig, no age key.
- [ ] No secret (tfvars, tfstate, `.env`, `ca.pem`) is tracked in git.

---

## Follow-on (NOT in this plan — separate spec/plan)

These are explicitly deferred (spec §1 out-of-scope, D9/D10) — do **not** execute here:

1. **Backend cutover** — update `DATABASE_URL` in the SOPS-encrypted `exercir-secrets` overlay(s), redeploy the `exercir` k8s backend to the managed instance, add the **cluster egress IP** to `pg_allowed_cidrs`. The in-cluster StatefulSet stays as fallback until verified.
2. **Data migration** — `pg_dump` from the in-cluster DB (via `kubectl -n exercir port-forward svc/postgres`) → restore into the managed instance.
3. **Retire** the in-cluster `postgres` StatefulSet + `postgres-init` ConfigMap once cutover is proven.
4. **Other domains** (markets, health, agri, whales, substrate, devloop) — add their databases on demand (each via its own `db:setup`/migrate).
5. **Dedicated pgvector instance** — if the knowledge/vector workload migrates and Task 3 was FAIL.

## Notes on the spec ↔ reality reconciliation

- The spec's D3 says "reuse `tools/db/setup.mjs`" — that is the **new-domain template**. **exercir** (the legacy domain) has no such script; its equivalent is the existing `npm run db:setup:core` (creates the `app` role from substrate's `sql/app-roles.sql` + the kernel SQL) followed by `npm run db:deploy`. This plan uses exercir's real scripts; the spec's intent (reuse the domain's own provisioning, don't fork RLS) is preserved.
