# Self-Hosted Shared Dev Postgres (in-cluster, TLS-exposed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⛔ This is a hybrid plan.** **Tasks 1–4 are committable manifests** authored + validated client-side (`kubectl kustomize`, no cluster). **Tasks 5–9 are ⛔ GATE live operations** against the founder's real Infomaniak k8s cluster + DNS (apply, LoadBalancer, DNS A-record, Let's Encrypt issuance, DB provisioning). A worker MUST NOT run a ⛔ GATE task autonomously — author the commands, then pause and have the founder run each gated step, reconfirming immediately before. Secrets (SOPS plaintext, passwords, keys) are never committed unencrypted.

**Goal:** Stand up a dedicated PostgreSQL 16 + pgvector StatefulSet in a new `shared-db` namespace on the existing Infomaniak k8s cluster, exposed via a LoadBalancer on 5432 with a Let's Encrypt DNS-01 cert (`db.dev.exercir.ch`) and a CIDR allowlist, so several dev machines connect directly over TLS (`sslmode=verify-full`, system CA, no `ca.pem`, no kubeconfig).

**Architecture:** A Kustomize base (`k8s/shared-db/base`: namespace, pg-config ConfigMap, LoadBalancer Service, StatefulSet, cert-manager Certificate) + a `dev` overlay (source-range patch, pg_hba patch, SOPS-encrypted credentials). TLS via the already-provisioned `letsencrypt-*-infomaniak` DNS-01 issuer. Access control is two-layer: `loadBalancerSourceRanges` (cloud) + `pg_hba.conf` `hostssl` CIDR rules (Postgres). The DB/roles/migrations reuse exercir's own `db:setup:core` + `db:deploy` (don't fork RLS). The existing in-cluster app Postgres is untouched (fallback); app cutover is a deferred follow-on.

**Tech Stack:** Kubernetes (Infomaniak managed k8s), Kustomize, `pgvector/pgvector:pg16` (PostgreSQL 16), cert-manager + Let's Encrypt DNS-01 (Infomaniak webhook, ADR-142), SOPS + age, `psql`, Prisma 6 (exercir), `kubectl`.

## Global Constraints

_Every task's requirements implicitly include this section._

- **All manifests live under `layers/platform/k8s/shared-db/`.** Paths below are relative to the `de-braighter/layers/platform` repo root.
- **Validate manifests client-side before any live apply:** `kubectl kustomize <dir>` builds with no cluster contact. This is the test for Tasks 1–4.
- **Never commit plaintext secrets.** `secrets.yaml` is SOPS-encrypted via the existing rule in `k8s/.sops.yaml` (`encrypted_regex: ^(data|stringData)$`, age recipient `age14vc0uv9smqtreaeaumpeztts544ma53e434xcscnpgcq4s2jsqwsfqn5rt`). The age **private** key is held out-of-band by the founder.
- **Image** `pgvector/pgvector:pg16` (PostgreSQL 16 + pgvector). Re-pin the digest before any prod use.
- **Postgres key-file perms:** Postgres refuses a group/world-readable TLS key; k8s mounts Secrets `root:root 0644`. An initContainer copies the cert/key into an `emptyDir`, `chmod 0600` the key, `chown` to uid `999` (the postgres user in the official image).
- **Source-IP preservation:** the Service sets `externalTrafficPolicy: Local` so Postgres sees the real client IP (required for `pg_hba` CIDR rules). If Octavia SNATs regardless (verify in Task 7), `loadBalancerSourceRanges` becomes the primary IP gate and `pg_hba` enforces TLS+password only.
- **`loadBalancerSourceRanges` and `pg_hba` allowlists are NEVER empty.** Access always requires TLS (`hostssl`) + a valid password.
- **Client connection:** host MUST be `db.dev.exercir.ch` (matches the cert SAN; `verify-full` requires it).
- **LE issuer:** validate with `letsencrypt-staging-infomaniak` first (untrusted cert, no rate-limit burn), then switch to `letsencrypt-prod-infomaniak`.
- **`npm install` in `domains/exercir`** needs `GITHUB_TOKEN` (classic PAT, `read:packages`) for the `@de-braighter/*` GitHub Packages deps.
- **⛔ GATE tasks (5–9)** are founder-run against the real cluster; reconfirm immediately before each.

---

### Task 1: Base — namespace, pg-config ConfigMap, LoadBalancer Service

Committable. Test: `kubectl kustomize k8s/shared-db/base` builds these three objects.

**Files:**
- Create: `k8s/shared-db/base/namespace.yaml`
- Create: `k8s/shared-db/base/pg-config.yaml`
- Create: `k8s/shared-db/base/service.yaml`
- Create: `k8s/shared-db/base/kustomization.yaml`

**Interfaces:**
- Produces: namespace `shared-db`; ConfigMap `shared-db-pg-config` (key `pg_hba.conf`); Service `shared-db-postgres` (type LoadBalancer, port 5432, selector `app.kubernetes.io/name: shared-db-postgres`). Consumed by Tasks 2–4.

- [ ] **Step 1: Create the namespace**

`k8s/shared-db/base/namespace.yaml`:

```yaml
---
apiVersion: v1
kind: Namespace
metadata:
  name: shared-db
  labels:
    app.kubernetes.io/part-of: shared-db
```

- [ ] **Step 2: Create the pg-config ConfigMap (baseline pg_hba)**

`k8s/shared-db/base/pg-config.yaml`. Baseline allows only the local socket (probes) + loopback; the dev overlay replaces `pg_hba.conf` with the real CIDR allowlist (Task 4):

```yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: shared-db-pg-config
  namespace: shared-db
  labels:
    app.kubernetes.io/part-of: shared-db
data:
  # Authoritative allowlist — hostssl only (TLS required). NO plaintext `host` lines.
  # The dev overlay (pg-hba-patch.yaml) REPLACES this key with the dev CIDR allowlist.
  pg_hba.conf: |
    # TYPE   DATABASE  USER  ADDRESS        METHOD
    local    all       all                  scram-sha-256
    hostssl  all       all   127.0.0.1/32   scram-sha-256
```

- [ ] **Step 3: Create the LoadBalancer Service**

`k8s/shared-db/base/service.yaml`. `externalTrafficPolicy: Local` preserves the client source IP for `pg_hba`. `loadBalancerSourceRanges` is added by the dev overlay:

```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: shared-db-postgres
  namespace: shared-db
  labels:
    app.kubernetes.io/name: shared-db-postgres
    app.kubernetes.io/part-of: shared-db
spec:
  type: LoadBalancer
  externalTrafficPolicy: Local
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
      protocol: TCP
  selector:
    app.kubernetes.io/name: shared-db-postgres
```

- [ ] **Step 4: Create the base kustomization**

`k8s/shared-db/base/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - namespace.yaml
  - pg-config.yaml
  - service.yaml
```

- [ ] **Step 5: Build to verify (the test)**

Run: `kubectl kustomize k8s/shared-db/base`
Expected: clean YAML output containing the `Namespace`, `ConfigMap`, and `Service`; no error.

- [ ] **Step 6: Commit**

```bash
git add k8s/shared-db/base/namespace.yaml \
        k8s/shared-db/base/pg-config.yaml \
        k8s/shared-db/base/service.yaml \
        k8s/shared-db/base/kustomization.yaml
git commit -m "feat(shared-db): base namespace + pg-config + LoadBalancer Service"
```

---

### Task 2: Base — Postgres StatefulSet (TLS-perms initContainer + PVC)

Committable. Test: `kubectl kustomize k8s/shared-db/base` now also emits the StatefulSet.

**Files:**
- Create: `k8s/shared-db/base/statefulset.yaml`
- Modify: `k8s/shared-db/base/kustomization.yaml` (add `statefulset.yaml`)

**Interfaces:**
- Consumes: ConfigMap `shared-db-pg-config`, Secret `shared-db-credentials` (Task 6), Secret `db-dev-exercir-tls` (cert from Task 3), Service selector labels (Task 1).
- Produces: StatefulSet `shared-db-postgres` (1 replica), PVC `data` (10Gi), pod labels `app.kubernetes.io/name: shared-db-postgres`.

- [ ] **Step 1: Create the StatefulSet**

`k8s/shared-db/base/statefulset.yaml`:

```yaml
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: shared-db-postgres
  namespace: shared-db
  labels:
    app.kubernetes.io/name: shared-db-postgres
    app.kubernetes.io/part-of: shared-db
spec:
  serviceName: shared-db-postgres
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: shared-db-postgres
  template:
    metadata:
      labels:
        app.kubernetes.io/name: shared-db-postgres
        app.kubernetes.io/part-of: shared-db
    spec:
      securityContext:
        fsGroup: 999            # postgres gid in the official image — makes the PVC group-writable
      initContainers:
        # Postgres refuses a group/world-readable key. k8s mounts the cert Secret
        # root:root 0644, so copy it out and fix ownership/permissions.
        - name: tls-perms
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              cp /tls-src/tls.crt /tls/tls.crt
              cp /tls-src/tls.key /tls/tls.key
              chown 999:999 /tls/tls.crt /tls/tls.key
              chmod 0644 /tls/tls.crt
              chmod 0600 /tls/tls.key
          volumeMounts:
            - { name: tls-src, mountPath: /tls-src, readOnly: true }
            - { name: tls, mountPath: /tls }
      containers:
        - name: postgres
          image: pgvector/pgvector:pg16
          # Args start with '-' so the official entrypoint prepends `postgres`.
          args:
            - -c
            - ssl=on
            - -c
            - ssl_cert_file=/tls/tls.crt
            - -c
            - ssl_key_file=/tls/tls.key
            - -c
            - hba_file=/etc/postgresql/pg_hba.conf
            - -c
            - listen_addresses=*
            - -c
            - password_encryption=scram-sha-256
          ports:
            - { containerPort: 5432, name: postgres }
          env:
            - name: POSTGRES_DB
              value: exercir
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef: { name: shared-db-credentials, key: POSTGRES_USER }
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef: { name: shared-db-credentials, key: POSTGRES_PASSWORD }
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data }
            - { name: tls, mountPath: /tls }
            - { name: pg-config, mountPath: /etc/postgresql/pg_hba.conf, subPath: pg_hba.conf }
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { cpu: "1",  memory: 1Gi }
          readinessProbe:
            exec: { command: [pg_isready, -U, $(POSTGRES_USER), -d, exercir] }
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            exec: { command: [pg_isready, -U, $(POSTGRES_USER), -d, exercir] }
            initialDelaySeconds: 30
            periodSeconds: 30
      volumes:
        - name: tls-src
          secret:
            secretName: db-dev-exercir-tls   # produced by cert-manager (Task 3)
        - name: tls
          emptyDir: {}
        - name: pg-config
          configMap:
            name: shared-db-pg-config
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 10Gi
```

- [ ] **Step 2: Reference it in the base kustomization**

Edit `k8s/shared-db/base/kustomization.yaml` `resources:` to add `statefulset.yaml`:

```yaml
resources:
  - namespace.yaml
  - pg-config.yaml
  - service.yaml
  - statefulset.yaml
```

- [ ] **Step 3: Build to verify (the test)**

Run: `kubectl kustomize k8s/shared-db/base`
Expected: output now includes the `StatefulSet shared-db-postgres` with the initContainer and `volumeClaimTemplates`; no error.

- [ ] **Step 4: Commit**

```bash
git add k8s/shared-db/base/statefulset.yaml k8s/shared-db/base/kustomization.yaml
git commit -m "feat(shared-db): Postgres 16 StatefulSet with TLS-perms initContainer + 10Gi PVC"
```

---

### Task 3: Base — cert-manager Certificate (DNS-01, staging issuer)

Committable. Test: `kubectl kustomize k8s/shared-db/base` emits the Certificate.

**Files:**
- Create: `k8s/shared-db/base/certificate.yaml`
- Modify: `k8s/shared-db/base/kustomization.yaml` (add `certificate.yaml`)

**Interfaces:**
- Produces: cert-manager `Certificate` `db-dev-exercir-tls` → Secret `db-dev-exercir-tls` (consumed by the StatefulSet `tls-src` volume in Task 2).

- [ ] **Step 1: Create the Certificate (staging issuer first)**

`k8s/shared-db/base/certificate.yaml`. Mirrors `k8s/overlays/dev/certificate.yaml`; uses the **staging** DNS-01 issuer — Task 7 switches to prod after a successful smoke test:

```yaml
---
# DNS-01 cert for the shared dev Postgres endpoint (ADR-142 Infomaniak webhook).
# Staging issuer first (untrusted, no rate-limit burn); Task 7 flips to prod.
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: db-dev-exercir-tls
  namespace: shared-db
  labels:
    app.kubernetes.io/part-of: shared-db
spec:
  secretName: db-dev-exercir-tls
  duration: 2160h   # 90d
  renewBefore: 360h # 15d
  issuerRef:
    name: letsencrypt-staging-infomaniak
    kind: ClusterIssuer
  commonName: db.dev.exercir.ch
  dnsNames:
    - db.dev.exercir.ch
```

- [ ] **Step 2: Reference it in the base kustomization**

Edit `k8s/shared-db/base/kustomization.yaml` `resources:` to add `certificate.yaml`:

```yaml
resources:
  - namespace.yaml
  - pg-config.yaml
  - service.yaml
  - statefulset.yaml
  - certificate.yaml
```

- [ ] **Step 3: Build to verify (the test)**

Run: `kubectl kustomize k8s/shared-db/base`
Expected: output includes the `Certificate db-dev-exercir-tls` referencing `letsencrypt-staging-infomaniak`; no error.

- [ ] **Step 4: Commit**

```bash
git add k8s/shared-db/base/certificate.yaml k8s/shared-db/base/kustomization.yaml
git commit -m "feat(shared-db): cert-manager Certificate for db.dev.exercir.ch (DNS-01, staging)"
```

---

### Task 4: Dev overlay — source-range + pg_hba allowlists, SOPS credentials scaffold

Committable (the committed `secrets.yaml` is SOPS-encrypted; real values are filled in Task 6). Test: `kubectl kustomize k8s/shared-db/overlays/dev` builds.

**Files:**
- Create: `k8s/shared-db/overlays/dev/kustomization.yaml`
- Create: `k8s/shared-db/overlays/dev/service-patch.yaml`
- Create: `k8s/shared-db/overlays/dev/pg-hba-patch.yaml`
- Create: `k8s/shared-db/overlays/dev/secrets.example.yaml` (the committed template; the real `secrets.yaml` is created + encrypted in Task 6 and is gitignored-by-encryption)

**Interfaces:**
- Consumes: the base (Tasks 1–3).
- Produces: dev `loadBalancerSourceRanges`, dev `pg_hba.conf`, and the Secret `shared-db-credentials` shape.

- [ ] **Step 1: Service patch — dev source ranges**

`k8s/shared-db/overlays/dev/service-patch.yaml` (the founder's current public IP is pre-seeded; add more `/32`s as devs onboard):

```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: shared-db-postgres
  namespace: shared-db
spec:
  # Best-effort cloud-layer allowlist. NEVER empty. pg_hba is the authoritative gate.
  loadBalancerSourceRanges:
    - 178.197.198.109/32
```

- [ ] **Step 2: pg_hba patch — dev CIDR allowlist (authoritative)**

`k8s/shared-db/overlays/dev/pg-hba-patch.yaml` replaces the ConfigMap's `pg_hba.conf` with the dev allowlist (`hostssl` only):

```yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: shared-db-pg-config
  namespace: shared-db
data:
  pg_hba.conf: |
    # TYPE   DATABASE  USER  ADDRESS              METHOD
    local    all       all                        scram-sha-256
    hostssl  all       all   127.0.0.1/32         scram-sha-256
    # --- dev allowlist (one hostssl line per dev /32). NO plaintext host lines. ---
    hostssl  all       all   178.197.198.109/32   scram-sha-256
```

- [ ] **Step 3: Secret template (committed, no real values)**

`k8s/shared-db/overlays/dev/secrets.example.yaml`:

```yaml
---
# Template only. Task 6 copies this to secrets.yaml, fills real values, and
# `sops -e -i` encrypts it (k8s/.sops.yaml encrypts data|stringData). Never commit
# secrets.yaml in plaintext.
apiVersion: v1
kind: Secret
metadata:
  name: shared-db-credentials
  namespace: shared-db
type: Opaque
stringData:
  POSTGRES_USER: exercir_admin
  POSTGRES_PASSWORD: REPLACE_ME_STRONG_PASSWORD
```

- [ ] **Step 4: Dev overlay kustomization**

`k8s/shared-db/overlays/dev/kustomization.yaml`. The SOPS secret is applied separately (Task 7) via `sops -d | kubectl apply` to avoid a KSOPS dependency, so it is **not** in `resources`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

patches:
  - path: service-patch.yaml
    target:
      kind: Service
      name: shared-db-postgres
  - path: pg-hba-patch.yaml
    target:
      kind: ConfigMap
      name: shared-db-pg-config
```

- [ ] **Step 5: Build to verify (the test)**

Run: `kubectl kustomize k8s/shared-db/overlays/dev`
Expected: build succeeds; the Service shows `loadBalancerSourceRanges: [178.197.198.109/32]` and `externalTrafficPolicy: Local`; the ConfigMap's `pg_hba.conf` shows the dev `hostssl` line. (The Secret is intentionally absent — applied separately in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add k8s/shared-db/overlays/dev/kustomization.yaml \
        k8s/shared-db/overlays/dev/service-patch.yaml \
        k8s/shared-db/overlays/dev/pg-hba-patch.yaml \
        k8s/shared-db/overlays/dev/secrets.example.yaml
git commit -m "feat(shared-db): dev overlay — source-range + pg_hba allowlists + secret template"
```

> **PR note:** push a branch and open a PR for Tasks 1–4 (manifests only, no live resources). Review normally before the ⛔ GATE tasks.

---

### Task 5: ⛔ GATE — Cluster pre-flight (issuer + webhook readiness)

**Live, read-only, founder-run.** Confirms the cluster prerequisites the design assumes (spec V2). No changes.

**Interfaces:**
- Consumes: founder's kubeconfig for the Infomaniak dev cluster.
- Produces: a PASS/blocked decision recorded in the PR/handoff.

- [ ] **Step 1: Confirm kube context + cert-manager**

```bash
kubectl config current-context
kubectl get pods -n cert-manager
```

Expected: the dev cluster context; cert-manager pods Running.

- [ ] **Step 2: Confirm the DNS-01 issuer + webhook + API token Secret**

```bash
kubectl get clusterissuer letsencrypt-staging-infomaniak letsencrypt-prod-infomaniak
kubectl get secret infomaniak-api-credentials -n cert-manager
kubectl get certificate -n exercir exercir-ch-wildcard-tls -o wide
```

Expected: both ClusterIssuers exist; `infomaniak-api-credentials` exists; the existing wildcard cert is `READY=True` (proves the DNS-01 path works end-to-end).

- [ ] **Step 3: Decide + record**

- **All present + wildcard READY** → proceed.
- **Issuer/webhook/secret missing or wildcard not READY** → STOP; re-provision the webhook per ADR-142 / `docs/getting-started/infomaniak-bootstrap.md` Step 5 before continuing.

---

### Task 6: ⛔ GATE — Create + encrypt the credentials Secret

**Founder-run.** Produces the SOPS-encrypted `secrets.yaml` (no plaintext committed).

**Interfaces:**
- Consumes: the age private key (out-of-band), `secrets.example.yaml`.
- Produces: encrypted `k8s/shared-db/overlays/dev/secrets.yaml`.

- [ ] **Step 1: Create from the template + set a strong password**

```bash
cd layers/platform/k8s/shared-db/overlays/dev
cp secrets.example.yaml secrets.yaml
# Set POSTGRES_PASSWORD to a strong value (e.g. `openssl rand -base64 24`).
# Keep POSTGRES_USER=exercir_admin. Save the password to your password manager.
```

- [ ] **Step 2: Encrypt in place with SOPS**

```bash
sops -e -i secrets.yaml
```

Expected: `stringData` values are now ENC[...]; `metadata`/`kind` remain cleartext. (SOPS auto-applies the `k8s/.sops.yaml` rule + age recipient.)

- [ ] **Step 3: Verify no plaintext password remains**

```bash
grep -c "REPLACE_ME\|exercir_admin" secrets.yaml || true   # POSTGRES_USER may be encrypted too
sops -d secrets.yaml | grep POSTGRES_USER                  # decrypts cleanly
```

Expected: the file on disk shows `ENC[...]`, not the plaintext password; `sops -d` round-trips. **Confirm `git status` does not stage a plaintext secret** (the file matches `*secrets.yaml` and is encrypted; commit it encrypted, or leave it local — founder's choice per repo convention).

---

### Task 7: ⛔ GATE — Apply, expose, DNS, issue cert (staging → prod)

**Live, founder-run.** Creates the LoadBalancer, sets DNS, issues the cert. Reconfirm before applying.

**Interfaces:**
- Consumes: Tasks 1–4 manifests; Task 6 secret; founder's Infomaniak DNS access.
- Produces: a running Postgres reachable at `db.dev.exercir.ch:5432` over TLS.

- [ ] **Step 1: Apply the manifests + the secret**

```bash
cd layers/platform
kubectl apply -k k8s/shared-db/overlays/dev
sops -d k8s/shared-db/overlays/dev/secrets.yaml | kubectl apply -f -
```

Expected: namespace, ConfigMap, Service, StatefulSet, Certificate, Secret created. The pod stays `Pending`/`ContainerCreating` until the cert Secret exists (next steps) — that is expected.

- [ ] **Step 2: Get the LoadBalancer public IP**

```bash
kubectl get svc -n shared-db shared-db-postgres -w
```

Expected: `EXTERNAL-IP` populates (Octavia provisions an IP; may take 1–3 min). Record it as `<LB_IP>`.

- [ ] **Step 3: Set the DNS A-record**

In Infomaniak DNS for `exercir.ch`, add: `db.dev.exercir.ch  A  <LB_IP>`. Verify:

```bash
nslookup db.dev.exercir.ch     # resolves to <LB_IP>
```

- [ ] **Step 4: Wait for the (staging) cert + pod**

```bash
kubectl get certificate -n shared-db db-dev-exercir-tls -o wide
kubectl describe certificate -n shared-db db-dev-exercir-tls | tail -20
kubectl get pods -n shared-db -w
```

Expected: certificate `READY=True` (DNS-01 TXT solved by the Infomaniak webhook, ~1–3 min); the pod becomes `Running` + `Ready` once the `db-dev-exercir-tls` Secret exists.

- [ ] **Step 5: Smoke-test TLS (staging cert is untrusted — use `require`)**

```bash
psql "host=db.dev.exercir.ch port=5432 user=exercir_admin dbname=exercir sslmode=require" -c "\conninfo"
```

Expected: connects over SSL (cert is the LE **staging** CA, so `verify-full` would fail here — that is expected; `require` proves the TLS plumbing + password + LB path). **If the connection times out from an allowlisted IP, verify source-IP preservation (V):** `kubectl logs -n shared-db sts/shared-db-postgres | grep "no pg_hba"`; if Postgres logs the LB/node IP instead of your public IP, Octavia is SNATing — rely on `loadBalancerSourceRanges` as the IP gate and relax the `pg_hba` line to a broader trusted range (still `hostssl`).

- [ ] **Step 6: Switch to the prod issuer**

Edit `k8s/shared-db/base/certificate.yaml` `issuerRef.name` → `letsencrypt-prod-infomaniak`, then:

```bash
kubectl apply -k k8s/shared-db/overlays/dev
kubectl describe certificate -n shared-db db-dev-exercir-tls | tail -20
# Force re-issue if cert-manager doesn't pick up the issuer change promptly:
#   kubectl delete secret -n shared-db db-dev-exercir-tls && kubectl apply -k k8s/shared-db/overlays/dev
kubectl rollout restart statefulset -n shared-db shared-db-postgres   # reload the new cert (dev default)
```

Expected: certificate re-issued by `letsencrypt-prod-infomaniak`, `READY=True`. Commit the issuer flip:

```bash
git add k8s/shared-db/base/certificate.yaml
git commit -m "feat(shared-db): switch Certificate to letsencrypt-prod-infomaniak"
```

- [ ] **Step 7: Verify `verify-full` works (public CA, no ca.pem)**

```bash
psql "host=db.dev.exercir.ch port=5432 user=exercir_admin dbname=exercir sslmode=verify-full" -c "\conninfo"
```

Expected: connects with an **SSL** connection verified against the **system CA store** — no `ca.pem` supplied.

---

### Task 8: ⛔ GATE — Provision `exercir` DB roles + migrations

**Founder-run, from an allowlisted machine.** Reuses exercir's own scripts so RLS/role logic isn't forked.

**Interfaces:**
- Consumes: Task 7 endpoint (`db.dev.exercir.ch`), the admin password (Task 6), `GITHUB_TOKEN` (read:packages).
- Produces: the `exercir` DB with `core.*`/`kernel.*` + pack schemas, the non-superuser `app` role, applied migrations.

- [ ] **Step 1: Write exercir's gitignored `.env`**

In `domains/exercir/.env` (copy from `.env.example`; gitignored), set — URL-encode the admin password if it has special chars; the `app:app` default comes from substrate's `app-roles.sql` (dev):

```dotenv
DATABASE_URL="postgresql://exercir_admin:ADMIN_PASSWORD@db.dev.exercir.ch:5432/exercir?sslmode=verify-full"
SUBSTRATE_APP_DATABASE_URL="postgresql://app:app@db.dev.exercir.ch:5432/exercir?sslmode=verify-full"
GITHUB_TOKEN=ghp_...   # read:packages
```

- [ ] **Step 2: Install + provision core roles/schemas**

```bash
cd domains/exercir
npm install
npm run db:setup:core
```

Expected: each `prisma db execute` reports success — `app-roles.sql` creates the `app` role (NOSUPERUSER, NOBYPASSRLS), the kernel SQL creates `core.*`/`kernel.*`. **If `app-roles.sql` fails on missing `CREATEROLE`,** confirm `exercir_admin` was created as a superuser by the image (it is — `POSTGRES_USER` is a superuser on first init).

- [ ] **Step 3: Apply migrations**

```bash
npm run db:deploy
```

Expected: `prisma migrate deploy` applies all migrations; `football`, `kernel`, `kids_football` schemas are created. (pgvector is present in the image, so any `CREATE EXTENSION vector` succeeds.)

- [ ] **Step 4: (Optional) seed the football stub**

```bash
npm run db:seed:football
```

- [ ] **Step 5: Verify roles + schemas**

```bash
psql "host=db.dev.exercir.ch port=5432 user=exercir_admin dbname=exercir sslmode=verify-full" \
  -c "\du app" -c "\dn"
```

Expected: role `app` exists and is **not** Superuser; schemas include `core`, `kernel`, `football`, `kids_football`.

---

### Task 9: ⛔ GATE — Dev onboarding + acceptance

**Founder-run.** Delivers the goal: another machine reaches the DB with only a connection string — no kubeconfig/age key/`ca.pem`.

**Interfaces:**
- Consumes: the running DB; the dev overlay allowlists.
- Produces: a verified second-machine connection; acceptance recorded.

- [ ] **Step 1: Allowlist a second machine**

On the second machine: `curl -s https://ifconfig.me` → `<IP2>`. Add `<IP2>/32` to **both** `k8s/shared-db/overlays/dev/service-patch.yaml` (`loadBalancerSourceRanges`) and `pg-hba-patch.yaml` (a `hostssl … <IP2>/32 … scram-sha-256` line), then:

```bash
kubectl apply -k k8s/shared-db/overlays/dev
git add k8s/shared-db/overlays/dev/service-patch.yaml k8s/shared-db/overlays/dev/pg-hba-patch.yaml
git commit -m "chore(shared-db): allowlist second dev machine"
```

(ConfigMap change is picked up on the next Postgres reload/restart: `kubectl rollout restart statefulset -n shared-db shared-db-postgres`.)

- [ ] **Step 2: Connect from the second machine (app role, verify-full, no ca.pem)**

```bash
psql "host=db.dev.exercir.ch port=5432 user=app dbname=exercir sslmode=verify-full" \
  -c "\conninfo" -c "select count(*) from kernel.event_log;"
```

Expected: `\conninfo` reports an **SSL** connection; the query runs as `app` (subject to RLS).

- [ ] **Step 3: Negative test — a non-allowlisted IP is rejected**

From a machine NOT in the allowlist (or temporarily remove your `/32` and re-apply): the connection should fail (timeout at the LB if `loadBalancerSourceRanges` is honored, or `no pg_hba.conf entry` from Postgres). Record which layer rejected it.

- [ ] **Step 4: Acceptance checklist** (record in the handoff/PR)

- [ ] `shared-db` StatefulSet Running; 10Gi PVC bound.
- [ ] Service has an external IP; `db.dev.exercir.ch` resolves to it.
- [ ] cert-manager issued a **prod** LE cert (after the staging smoke test).
- [ ] A dev connects `sslmode=verify-full` with **no `ca.pem`**, from an allowlisted IP.
- [ ] A non-allowlisted IP is rejected; the rejecting layer is recorded.
- [ ] `exercir` DB exists; `app` role is non-superuser; migrations applied; schemas `core`/`kernel`/`football`/`kids_football` present.
- [ ] No plaintext secret is committed (`secrets.yaml` is SOPS-encrypted).

---

## Follow-on (NOT in this plan — separate spec/plan)

1. **App cutover** — repoint the deployed exercir backend at `db.dev.exercir.ch` (SOPS overlay `DATABASE_URL`), keeping the in-cluster StatefulSet as fallback until verified.
2. **Staging instance** — `db.staging.exercir.ch` via a `staging` overlay (same base).
3. **Backups** — a `pg_dump` CronJob (to Object Storage once the S3 credential issue is resolved, or to a PVC).
4. **Zero-downtime cert reload** — a `SIGHUP`-reloader sidecar instead of a restart-on-renewal.
5. **Other domains** — add their databases on the same instance on demand (each via its own `db:setup`/migrate).

## Notes on spec ↔ reality reconciliation

- The spec's pg_hba "authoritative allowlist" depends on **source-IP preservation** (`externalTrafficPolicy: Local`). Task 7 Step 5 verifies it; if Octavia SNATs regardless, `loadBalancerSourceRanges` carries the IP allowlist and `pg_hba` enforces TLS+password. Either way: no access without TLS + a valid password + being on an allowlist.
- The existing `k8s/overlays/dev/certificate.yaml` already issues `*.dev.exercir.ch` via the same DNS-01 issuer — reused here only as **proof the issuer works** (Task 5 Step 2); `shared-db` issues its own namespace-scoped cert.
