# Self-Hosted Shared Dev Postgres (in-cluster, TLS-exposed) — Design Spec

> Status: **proposed** · 2026-07-01 · Supersedes the provisioning approach of
> `2026-06-30-infomaniak-managed-postgres-dev-design.md` (managed DBaaS), which
> is invalidated — see Background. The **database/role/migration** reuse from
> that spec (don't fork RLS) is carried forward unchanged.

## Background & motivation

The 2026-06-30 plan aimed to stand up an **Infomaniak Managed PostgreSQL** (DBaaS)
as a shared dev/staging database. Attempting the live `tofu apply` revealed the
premise is false: **Infomaniak's Managed Database product does not offer PostgreSQL.**
The `infomaniak_dbaas` provider rejected `type = "postgresql"` with:

```
Error: Could not find DBaaS Pack
Validation failed: The selected filter.type is invalid. (possible values: [mysql])
```

The product offers MySQL/MariaDB (the provider's only doc example is `type = "mysql"`).
PostgreSQL is not available for this account/region. MySQL is not a substitute —
exercir's schema is Postgres-specific (RLS, `kernel.*`/`core.*` schemas, Prisma on PG,
pgvector). **Conclusion: we self-host Postgres on Infomaniak.** (No managed-DB
resource was ever created; no charge incurred.)

Toolchain note for any live IaC on this host: native `tofu` is blocked by Norton's
loopback-mTLS MITM; run tofu inside the `ghcr.io/opentofu/opentofu` Docker image
(the container network namespace bypasses the host WFP filter). Not needed for this
spec (k8s/kubectl), but relevant if a VM variant is ever revisited.

## Goal

A **dedicated shared dev/staging Postgres** that several developer machines connect
to **directly over TLS** — with just a connection string (and the system CA store),
**no kubeconfig and no age key**. This removes the only real friction today: the
existing in-cluster app Postgres is a `ClusterIP` service, reachable from a developer
machine only via `kubectl port-forward` (which needs cluster credentials).

## Non-goals (deferred follow-ons, not in this design)

1. **App cutover** — repointing the deployed exercir backend at this instance. The
   existing in-cluster app Postgres (`exercir` namespace) stays as the app's DB and
   fallback. Cutover is a separate spec/plan.
2. **Staging instance** — `db.staging.exercir.ch` via the same pattern, later.
3. **Backups** — dev data is reproducible from migrations + seed; a `pg_dump` CronJob
   is a later addition if the data becomes precious.
4. **Data migration** from the existing in-cluster DB.
5. **A dedicated Postgres VM** (the decoupled alternative) — explicitly not chosen
   (lower coupling but higher ops; dev/staging favors low ops).

## Architecture

### 1. Topology

A new namespace **`shared-db`** holding a dedicated **PostgreSQL 16 + pgvector**
StatefulSet (image `pgvector/pgvector:pg16`, 1 replica), separate from exercir's app
DB. Deployed declaratively via Kustomize (`k8s/shared-db/` base + a `dev` overlay),
mirroring the kids-football deploy workflow. A dedicated **10Gi Cinder PVC**
(`ReadWriteOnce`) backs `/var/lib/postgresql/data`.

### 2. Exposure (LoadBalancer + DNS)

A `Service` of `type: LoadBalancer` forwarding TCP **5432** → an Infomaniak Octavia
LoadBalancer with a public IP. The founder adds **one DNS A-record**
`db.dev.exercir.ch → <LB public IP>` in Infomaniak DNS after the LB IP is assigned.

### 3. TLS (Let's Encrypt via DNS-01)

A cert-manager **`Certificate`** for `db.dev.exercir.ch`, in the `shared-db` namespace,
referencing the **existing `letsencrypt-prod-infomaniak` ClusterIssuer** (DNS-01 via
Infomaniak's official cert-manager webhook, ADR-142). cert-manager writes a
`kubernetes.io/tls` Secret (`db-dev-exercir-tls`) with `tls.crt`/`tls.key`.

- **Why DNS-01, not HTTP-01:** `db.dev.exercir.ch` resolves to the *Postgres*
  LoadBalancer (port 5432 only) — there is no port-80 listener for an HTTP-01
  challenge. DNS-01 proves ownership via a TXT record, independent of the A-record
  target. The webhook + `Domain`-scoped API token (`infomaniak-api-credentials`) are
  already provisioned per ADR-142 / bootstrap Step 5.
- Validate first against **`letsencrypt-staging-infomaniak`** (untrusted cert, no
  rate-limit burn), then flip to prod.
- **Postgres TLS wiring:** `ssl = on`, `ssl_cert_file`/`ssl_key_file` point at the
  mounted cert. **Known gotcha:** Postgres refuses a key file that is group/world
  readable or not owned by the server user; a k8s Secret mounts as root:root 0644.
  An **initContainer copies `tls.crt`/`tls.key` into an `emptyDir`, `chmod 0600`,
  `chown` to the postgres uid**; Postgres reads from there. **On renewal (LE ~60-day
  cycle), the dev default is a pod restart** (the initContainer re-copies the new
  cert) — simplest and acceptable for a dev instance. A `SIGHUP`-reloader sidecar
  (zero-downtime) is a later refinement, not in scope here.
- **Client UX:** `sslmode=verify-full` against the **system CA store** — Let's Encrypt
  is publicly trusted, so **no `ca.pem` is distributed.** Hostname in the connection
  string must be `db.dev.exercir.ch` (matches the cert SAN; required by `verify-full`).

### 4. Access control — two layers (defense in depth)

1. **`loadBalancerSourceRanges`** on the Service (best-effort cloud layer) =
   developer public IPs (`178.197.198.109/32`, …). NEVER empty.
2. **`pg_hba.conf` `hostssl` CIDR allowlist** — the *guaranteed* layer, enforced by
   Postgres regardless of whether Octavia honors source ranges. Only `hostssl`
   (TLS-required) entries; no plaintext `host` lines. This is the authoritative
   allowlist; `loadBalancerSourceRanges` is a bonus network-layer filter.

### 5. Database, roles, migrations (carried forward from the managed spec)

Provision **by reusing exercir's own scripts** — do not fork RLS:

- `npm run db:setup:core` — creates the non-superuser **`app`** role (NOSUPERUSER,
  NOBYPASSRLS, from substrate's `sql/app-roles.sql`) and the `core.*`/`kernel.*`
  objects.
- `npm run db:deploy` — `prisma migrate deploy`; creates `football`/`kernel`/
  `kids_football` schemas.
- Optional `npm run db:seed:football`.

Roles: a privileged **admin** role (DB owner, `CREATEROLE`/`CREATEDB`, password in a
SOPS Secret) used by `db:setup`/`db:deploy`; the **`app`** role (RLS-bound) is the
default dev connection identity.

### 6. Persistence & secrets

- 10Gi Cinder PVC, single replica.
- Admin (and `app`) credentials in a **SOPS-encrypted `k8s/shared-db/overlays/dev/secrets.yaml`**,
  following the existing `.sops.yaml` pattern. `tls.*` comes from cert-manager (not SOPS).

## Component breakdown (manifest layout)

```
k8s/shared-db/
  base/
    namespace.yaml            # ns: shared-db
    statefulset.yaml          # PG16+pgvector, initContainer (cert perms), PVC template
    service.yaml              # type: LoadBalancer, port 5432, loadBalancerSourceRanges
    pg-hba-config.yaml        # ConfigMap: pg_hba.conf (hostssl CIDR allowlist) + postgresql.conf TLS
    certificate.yaml          # cert-manager Certificate (db.dev.exercir.ch, DNS-01 issuer)
    kustomization.yaml
  overlays/dev/
    kustomization.yaml
    secrets.yaml              # SOPS-encrypted admin/app passwords
    service-patch.yaml        # dev loadBalancerSourceRanges (dev IPs)
    pg-hba-patch.yaml         # dev CIDR allowlist
```

Each unit has one purpose and a clear interface: the StatefulSet owns the server +
TLS-perms initContainer; the Service owns exposure + the network allowlist; the
ConfigMap owns `pg_hba`/`postgresql.conf`; the Certificate owns TLS material. Changing
the allowlist touches only the Service patch + the pg_hba patch.

## Connection / onboarding flow

1. Founder applies the kustomize overlay; Octavia assigns a public IP.
2. Founder sets DNS `db.dev.exercir.ch → <LB IP>`; cert-manager issues the cert (DNS-01).
3. Founder runs `db:setup:core` + `db:deploy` against `db.dev.exercir.ch` (admin role).
4. A developer adds their public IP to the dev allowlist (Service patch + pg_hba patch),
   re-applies, and connects:
   ```
   DATABASE_URL="postgresql://app:<pw>@db.dev.exercir.ch:5432/exercir?sslmode=verify-full"
   ```
   No kubeconfig, no age key, no `ca.pem`.

## Decisions

- **D1 — In-cluster, not a VM.** Reuse the operated cluster (restarts, scheduling,
  Cinder storage) over owning a VM lifecycle. Dev/staging favors low ops over decoupling.
- **D2 — Dedicated instance, not the app DB.** Never expose exercir's live app DB to
  the internet; a separate `shared-db` instance is safe to expose and decouples dev
  access from the app.
- **D3 — Let's Encrypt DNS-01 (public cert).** Eliminates CA-file distribution; reuses
  the already-provisioned Infomaniak DNS-01 issuer. Postgres-on-5432 can't do HTTP-01.
- **D4 — pg_hba is the authoritative allowlist.** `loadBalancerSourceRanges` may or may
  not be honored by Octavia; `hostssl` CIDR rules in Postgres are guaranteed.
- **D5 — Reuse exercir `db:setup`/`db:deploy`.** Don't fork RLS/role logic (ADR-176
  spirit: the domain owns its provisioning).
- **D6 — pgvector image.** Same `pgvector/pgvector:pg16` as the app DB and dev stack;
  ready for the knowledge/vector workload without a second instance.

## Open verification items (surface in the plan; not blockers)

- **V1** — Confirm Infomaniak Octavia honors `loadBalancerSourceRanges` (pg_hba is the
  fallback regardless).
- **V2** — Confirm `infomaniak-api-credentials` Secret + the DNS-01 webhook are live in
  this cluster (ADR-142 says provisioned at bootstrap; verify with the staging issuer).
- **V3** — Confirm the Octavia LoadBalancer forwards raw TCP 5432 (L4) without an
  HTTP health-check that would mark a TCP-only backend unhealthy; use a TCP health
  monitor if configurable.
- **V4** — `npm install` in `domains/exercir` needs `GITHUB_TOKEN` (`read:packages`)
  for `@de-braighter/*` GitHub Packages deps (carried from the managed spec).

## Acceptance criteria

- [ ] `shared-db` PG StatefulSet is Running with a bound 10Gi PVC.
- [ ] `Service` has an external IP; `db.dev.exercir.ch` resolves to it.
- [ ] cert-manager issued a **prod** LE cert for `db.dev.exercir.ch` (after staging smoke test).
- [ ] A developer connects with `sslmode=verify-full`, **no `ca.pem`**, from an allowlisted IP.
- [ ] A non-allowlisted IP is rejected (pg_hba, even if it reaches the LB).
- [ ] `exercir` DB exists; `app` role is non-superuser; migrations applied; schemas
      `core`/`kernel`/`football`/`kids_football` present.
- [ ] No secret (SOPS plaintext, password, key) is committed unencrypted.

## References

- Pivoted-from: `docs/superpowers/specs/2026-06-30-infomaniak-managed-postgres-dev-design.md`
- Existing app PG: `layers/platform/k8s/base/postgres.yaml` (+ `postgres-init.yaml`)
- DNS-01 issuer: `layers/platform/k8s/base/cluster-issuer.yaml` (ADR-142)
- HTTP-01 issuer + ingress pattern: `layers/platform/k8s/cert-manager/clusterissuer-letsencrypt.yaml`,
  `layers/platform/k8s/kids-football/ingress.yaml`
- SOPS pattern: `layers/platform/k8s/.sops.yaml`, `k8s/overlays/*/secrets.yaml`
