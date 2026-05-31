# KG S3-shared index — Stage 2 (Infomaniak K8s deploy) Implementation Plan

> **For agentic workers:** This is a DEPLOY runbook, not a TDD code plan. Task 1 authors + locally-validates committable K8s manifests (PR'd to `layers/platform`). Tasks 2–5 are **gated operational steps** against the real Infomaniak cluster — each is marked ⛔ GATE and MUST be reconfirmed with the user immediately before running. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A nightly K8s CronJob on the real Infomaniak cluster (`pck-7e3mues`) rebuilds the memory-free shared KG base and publishes it to Infomaniak Object Storage, self-freshening the shared index in the cloud.

**Architecture:** Reuse the Stage-1 image **unchanged**, pushed to GHCR (private). A two-container Job pod: an `alpine/git` initContainer clones the shared corpus (`workbench`→`/cluster`, `specs`→`/cluster/layers/specs`) into an `emptyDir`, then the publish container runs the image's `kg:publish` with `DEVLOOP_CLUSTER_ROOT=/cluster` and `KG_S3_*` from a Secret.

**Tech Stack:** Docker + GHCR, kubectl/kustomize, Infomaniak Object Storage (Swiss Backup, S3-compatible), `@aws-sdk/client-s3` (already in the image).

**Spec:** `docs/superpowers/specs/2026-05-31-kg-s3-stage2-infomaniak-deploy-design.md`

**Findings folded in since the spec:**
- Endpoint is **Swiss Backup** (`s3.swiss-backup04.infomaniak.com`), not Public Cloud OS → **no terraform** (wrong module); bucket via S3 API only. An existing bucket `default` is present.
- Bucket strategy: **try to create `de-braighter-kg-index-prod`; if Swiss Backup forbids bucket creation, fall back to the existing `default` bucket with key `kg-index.json`.** Decided at Task 3.
- Secrets: **created via `kubectl create secret` from live creds at apply** (`domains/devloop/.env.infomaniak`, already filled + gitignored; `GITHUB_TOKEN` from env). Committed manifests are **templates only — no real secret values committed** (SOPS-GitOps deferred to a future deploy pipeline).

**Creds (read at apply, never echoed):** `domains/devloop/.env.infomaniak` (S3 endpoint + keypair + region) + `GITHUB_TOKEN` env. Auth already verified (read-only ListBuckets succeeded).

---

## File Structure

Committable (Task 1, PR'd to `layers/platform`):
- `layers/platform/k8s/kg-publish/namespace.yaml` — the `devloop` namespace.
- `layers/platform/k8s/kg-publish/cronjob.yaml` — the CronJob (initContainer clone + publish container).
- `layers/platform/k8s/kg-publish/kustomization.yaml` — kustomize entry + the image tag transformer.
- `layers/platform/k8s/kg-publish/secret-templates.yaml` — commented templates for the 3 secrets (NO real values).
- `layers/platform/k8s/kg-publish/README.md` — the apply runbook (this plan's operational steps, condensed).

Operational only (Tasks 2–5 — real-infra actions, not commits): the GHCR image, the bucket, and the live cluster resources.

---

## Task 1: Author + locally-validate the K8s manifests (committable; no cluster contact)

**Files:** the five files above. This task touches the real cluster **zero times** — only `kubectl --dry-run=client` + `kustomize build` (both fully local).

- [ ] **Step 1: namespace.yaml**

Create `layers/platform/k8s/kg-publish/namespace.yaml`:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: devloop
```

- [ ] **Step 2: cronjob.yaml**

Create `layers/platform/k8s/kg-publish/cronjob.yaml`:
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: kg-publish
  namespace: devloop
spec:
  schedule: "0 3 * * *" # nightly, UTC
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          imagePullSecrets:
            - name: ghcr
          volumes:
            - name: corpus
              emptyDir: {}
          initContainers:
            - name: clone
              image: alpine/git:2.45.2
              env:
                - name: GITHUB_TOKEN
                  valueFrom:
                    secretKeyRef:
                      name: github-token
                      key: token
              command: ["/bin/sh", "-c"]
              args:
                - |
                  set -eu
                  git clone --depth 1 "https://x-access-token:${GITHUB_TOKEN}@github.com/de-braighter/workbench.git" /cluster
                  git clone --depth 1 "https://x-access-token:${GITHUB_TOKEN}@github.com/de-braighter/specs.git" /cluster/layers/specs
              volumeMounts:
                - name: corpus
                  mountPath: /cluster
          containers:
            - name: publish
              image: ghcr.io/de-braighter/devloop-kg:latest # tag pinned at apply via kustomize
              env:
                - name: DEVLOOP_CLUSTER_ROOT
                  value: /cluster
              envFrom:
                - secretRef:
                    name: kg-s3
              volumeMounts:
                - name: corpus
                  mountPath: /cluster
              resources:
                requests:
                  cpu: 100m
                  memory: 256Mi
                limits:
                  cpu: 500m
                  memory: 512Mi
```
Note: the publish container uses the image's default `ENTRYPOINT/CMD` (`npx tsx src/cli.ts publish`). `envFrom: kg-s3` injects `KG_S3_*`. No `DEVLOOP_MEMORY_DIR` → memory-free base. The clone writes `/cluster` (workbench: policies/workflows/CLAUDE.md) + `/cluster/layers/specs` (specs: adr/concepts), exactly what `resolveConfig` expects under `DEVLOOP_CLUSTER_ROOT=/cluster`.

- [ ] **Step 3: kustomization.yaml**

Create `layers/platform/k8s/kg-publish/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - cronjob.yaml
images:
  - name: ghcr.io/de-braighter/devloop-kg
    newTag: latest # overridden at apply: `kustomize edit set image ...=:<sha>`
```

- [ ] **Step 4: secret-templates.yaml (NO real values — reference only)**

Create `layers/platform/k8s/kg-publish/secret-templates.yaml`:
```yaml
# TEMPLATES ONLY — do NOT apply this file and do NOT put real values here.
# The live secrets are created at apply via `kubectl create secret` from
# domains/devloop/.env.infomaniak + $GITHUB_TOKEN (see README). SOPS-GitOps is deferred.
#
# kg-s3 (Opaque): KG_S3_ENDPOINT, KG_S3_BUCKET, KG_S3_KEY,
#                 KG_S3_ACCESS_KEY_ID, KG_S3_SECRET_ACCESS_KEY, KG_S3_REGION
# github-token (Opaque): token=<PAT with repo + read:packages>
# ghcr (kubernetes.io/dockerconfigjson): docker-registry creds for ghcr.io
```

- [ ] **Step 5: README.md runbook**

Create `layers/platform/k8s/kg-publish/README.md`:
```markdown
# kg-publish — KG shared-base publisher (Stage 2)

Nightly CronJob that rebuilds the memory-free KG base (specs + governance) and
publishes it to Infomaniak Object Storage. Namespace: `devloop`. Image:
`ghcr.io/de-braighter/devloop-kg` (private). Spec:
`../../../../docs/superpowers/specs/2026-05-31-kg-s3-stage2-infomaniak-deploy-design.md`.

## Apply (operator-led, gated)
1. Build + push image (from domains/devloop) → `ghcr.io/de-braighter/devloop-kg:<sha>`.
2. Create the bucket (S3 API) or use `default`.
3. Create secrets:
   - `kubectl -n devloop create secret generic kg-s3 --from-env-file=<creds>` (+ BUCKET/KEY appended)
   - `kubectl -n devloop create secret generic github-token --from-literal=token=$GITHUB_TOKEN`
   - `kubectl -n devloop create secret docker-registry ghcr --docker-server=ghcr.io --docker-username=<gh-user> --docker-password=$GITHUB_TOKEN`
4. `kustomize edit set image ghcr.io/de-braighter/devloop-kg=ghcr.io/de-braighter/devloop-kg:<sha>` then `kubectl apply -k .`
5. Verify: `kubectl -n devloop create job kg-publish-manual --from=cronjob/kg-publish` → logs → object in bucket.

## Rollback
`kubectl delete -k .` (or `kubectl delete ns devloop`); delete the bucket object; delete the GHCR tag.
```

- [ ] **Step 6: Validate locally (NO cluster contact)**

Run (in `layers/platform/k8s/kg-publish`):
```bash
kubectl kustomize . > /tmp/kg-publish.rendered.yaml && echo "kustomize build OK"
kubectl apply --dry-run=client -f /tmp/kg-publish.rendered.yaml
```
Expected: kustomize renders; `--dry-run=client` reports `namespace/devloop created (dry run)` + `cronjob.batch/kg-publish created (dry run)` with no errors. **`--dry-run=client` does NOT contact the cluster** (client-side only) — safe.

- [ ] **Step 7: Commit + PR to platform**

```bash
cd layers/platform
git checkout -b feat/kg-publish-cronjob
git add k8s/kg-publish/
git commit -m "feat(k8s): kg-publish CronJob — KG shared-base publisher (Stage 2)"
git push -u origin feat/kg-publish-cronjob
gh pr create --base main --title "feat(k8s): kg-publish CronJob (Stage 2)" --body "K8s manifests for the nightly KG shared-base publisher. Implements the Stage-2 spec. Secrets created at apply (templates only committed). Producer: orchestrator/claude-opus-4-8 [writing-plans]"
```

---

## Task 2: ⛔ GATE — Build + push the GHCR image

**Reconfirm with the user before running.** This pushes a private image to `ghcr.io/de-braighter/...`.

- [ ] **Step 1: Resolve the git sha + GH user**

Run (in `domains/devloop`):
```bash
SHA=$(git rev-parse --short HEAD); echo "tag: $SHA"
GH_USER=$(gh api user -q .login); echo "ghcr user: $GH_USER"
```

- [ ] **Step 2: Build the image (BuildKit secret for npm ci)**

Run (in `domains/devloop`, with `GITHUB_TOKEN` in env):
```bash
export DOCKER_BUILDKIT=1
docker build --secret id=github_token,env=GITHUB_TOKEN -t ghcr.io/de-braighter/devloop-kg:$SHA -t ghcr.io/de-braighter/devloop-kg:latest .
```
Expected: build succeeds (npm ci authenticates via the secret, as proven in Stage 1).

- [ ] **Step 3: Login + push**

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GH_USER" --password-stdin
docker push ghcr.io/de-braighter/devloop-kg:$SHA
docker push ghcr.io/de-braighter/devloop-kg:latest
```
Expected: both tags push. Confirm the package exists + is **private** at `github.com/orgs/de-braighter/packages` (or `gh api`). Record `$SHA` for Task 4.

---

## Task 3: ⛔ GATE — Create the bucket

**Reconfirm before running.** Uses the Infomaniak keypair from `.env.infomaniak`.

- [ ] **Step 1: Try to create the dedicated bucket; fall back to `default`**

Run (in `domains/devloop`):
```bash
set -a; . ./.env.infomaniak; set +a
node -e "
import('@aws-sdk/client-s3').then(async ({S3Client, CreateBucketCommand, HeadBucketCommand}) => {
  const c = new S3Client({ endpoint: process.env.KG_S3_ENDPOINT, region: process.env.KG_S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.KG_S3_ACCESS_KEY_ID, secretAccessKey: process.env.KG_S3_SECRET_ACCESS_KEY } });
  const want = 'de-braighter-kg-index-prod';
  try { await c.send(new CreateBucketCommand({ Bucket: want })); console.log('BUCKET=' + want + ' (created)'); }
  catch (e) {
    try { await c.send(new HeadBucketCommand({ Bucket: want })); console.log('BUCKET=' + want + ' (already exists)'); }
    catch { console.log('FALLBACK — cannot create dedicated bucket (' + e.name + '); use existing default. BUCKET=default'); }
  }
});
"
```
Expected: either `BUCKET=de-braighter-kg-index-prod` or `BUCKET=default`. Record the result as the final `KG_S3_BUCKET`; `KG_S3_KEY=kg-index.json` either way (with `default`, the key namespaces it).

---

## Task 4: ⛔ GATE — Apply to the real cluster (`pck-7e3mues`)

**Reconfirm before running. This creates resources on your live Infomaniak cluster.**

- [ ] **Step 1: Confirm the kube context (safety interlock)**

```bash
CTX=$(kubectl config current-context); echo "$CTX"
test "$CTX" = "kubernetes-admin@pck-7e3mues" && echo "context OK" || { echo "WRONG CONTEXT — abort"; exit 1; }
```

- [ ] **Step 2: Namespace + secrets (from live creds; not committed)**

```bash
kubectl create namespace devloop --dry-run=client -o yaml | kubectl apply -f -
# kg-s3: the S3 env file + the bucket/key decided in Task 3
( set -a; . domains/devloop/.env.infomaniak; set +a
  kubectl -n devloop create secret generic kg-s3 \
    --from-literal=KG_S3_ENDPOINT="$KG_S3_ENDPOINT" \
    --from-literal=KG_S3_REGION="$KG_S3_REGION" \
    --from-literal=KG_S3_ACCESS_KEY_ID="$KG_S3_ACCESS_KEY_ID" \
    --from-literal=KG_S3_SECRET_ACCESS_KEY="$KG_S3_SECRET_ACCESS_KEY" \
    --from-literal=KG_S3_BUCKET="<BUCKET from Task 3>" \
    --from-literal=KG_S3_KEY="kg-index.json" \
    --dry-run=client -o yaml | kubectl apply -f - )
kubectl -n devloop create secret generic github-token --from-literal=token="$GITHUB_TOKEN" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n devloop create secret docker-registry ghcr --docker-server=ghcr.io --docker-username="$(gh api user -q .login)" --docker-password="$GITHUB_TOKEN" --dry-run=client -o yaml | kubectl apply -f -
```
(`--dry-run=client -o yaml | kubectl apply -f -` makes secret creation idempotent without printing values to logs beyond the apply confirmation.)

- [ ] **Step 3: Pin the image tag + apply the CronJob**

```bash
cd layers/platform/k8s/kg-publish
kubectl kustomize . | sed "s#ghcr.io/de-braighter/devloop-kg:latest#ghcr.io/de-braighter/devloop-kg:$SHA#" | kubectl apply -f -
kubectl -n devloop get cronjob kg-publish
```
Expected: `cronjob.batch/kg-publish` created; `namespace/devloop` configured; secrets present.

---

## Task 5: ⛔ GATE — Verify with a manual run

**Reconfirm before running.** Triggers one immediate publish.

- [ ] **Step 1: Trigger + watch**

```bash
kubectl -n devloop create job kg-publish-manual --from=cronjob/kg-publish
kubectl -n devloop wait --for=condition=complete job/kg-publish-manual --timeout=300s
kubectl -n devloop logs job/kg-publish-manual -c publish | tail -5
```
Expected: Job completes; publish-container log shows `kg publish: nodes=NNN edges=MMM -> <bucket>/kg-index.json` with NNN ≈ the memory-free base (~372). If the clone fails (token scope), the initContainer log shows it: `kubectl -n devloop logs job/kg-publish-manual -c clone`.

- [ ] **Step 2: Confirm the object landed**

```bash
cd domains/devloop && set -a; . ./.env.infomaniak; set +a
node -e "
import('@aws-sdk/client-s3').then(async ({S3Client, HeadObjectCommand}) => {
  const c = new S3Client({ endpoint: process.env.KG_S3_ENDPOINT, region: process.env.KG_S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.KG_S3_ACCESS_KEY_ID, secretAccessKey: process.env.KG_S3_SECRET_ACCESS_KEY } });
  const r = await c.send(new HeadObjectCommand({ Bucket: '<BUCKET>', Key: 'kg-index.json' }));
  console.log('OBJECT OK — size', r.ContentLength, 'bytes, modified', r.LastModified);
});
"
```
Expected: `OBJECT OK — size <hundreds-of-KB> …`. Stage 2 proven: the cloud CronJob publishes the shared base to Infomaniak.

- [ ] **Step 3: Clean up the manual job**

```bash
kubectl -n devloop delete job kg-publish-manual
```
The nightly CronJob remains. Done.

---

## Self-Review

**Spec coverage:** §1 goal → Tasks 1–5; §2 D1 (real cluster, gated) → Tasks 4/5 context-interlock + ⛔ gates; D2 (GHCR) → Task 2; D3 (image unchanged) → Task 2 reuses the Stage-1 Dockerfile, no edits; D4 (initContainer clone) → cronjob.yaml; D5 (bucket via S3 API, no tofu) → Task 3 (terraform-record dropped per Swiss Backup finding, noted); D6 (secrets at apply) → Task 4 kubectl-create (committed templates only); D7 (nightly) → cronjob schedule; D8 (namespace devloop) → namespace.yaml. §6 memory-absent → no `DEVLOOP_MEMORY_DIR`, clone is shared-repos-only. §7 four gates → Tasks 2–5. §8 verify/rollback → Task 5 + README.

**Placeholder scan:** the `<BUCKET from Task 3>` / `<BUCKET>` / `$SHA` are runtime values resolved in earlier steps (recorded explicitly), not unfilled placeholders. The secret-templates.yaml is intentionally value-free (a reference doc, never applied) — explicitly marked. No TBDs.

**Consistency:** `KG_S3_*` env names match the Stage-1 `resolveS3Config`; `DEVLOOP_CLUSTER_ROOT=/cluster` matches the Stage-1 config override; the image name `ghcr.io/de-braighter/devloop-kg` and tag `$SHA` are consistent across Tasks 2/4; secret names `kg-s3`/`github-token`/`ghcr` match between cronjob.yaml and Task 4.

**Gate discipline:** Task 1 is the only non-gated task and makes zero cluster contact (client-side validation only). Every cluster/registry/bucket mutation (Tasks 2–5) is ⛔-marked for reconfirmation.
