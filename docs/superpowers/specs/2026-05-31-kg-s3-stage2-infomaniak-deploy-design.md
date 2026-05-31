---
title: "KG S3-shared index — Stage 2 (Infomaniak K8s deploy) — technical design"
status: design (pre-execute) — for review
kind: technical-design
created: 2026-05-31
author: stibe
home: layers/platform (manifests + terraform) + GHCR (image) + domains/devloop (image source, unchanged)
relates-to:
  - docs/superpowers/specs/2026-05-31-kg-s3-shared-index-stage1-design.md
  - docs/superpowers/plans/2026-05-31-kg-s3-shared-index-stage1.md
  - layers/platform/terraform/modules/s3-bucket/
  - layers/platform/docs/getting-started/secrets-management.md
  - layers/specs/adr/adr-020-secrets-management-sops-age.md
note: >
  Stage 2 of the deployment pipe-clean: take the Stage-1 KG publish loop to the
  cloud — a K8s CronJob on the real Infomaniak cluster (pck-7e3mues) that
  rebuilds the shared base and publishes it to Infomaniak Object Storage on a
  schedule. The Stage-1 image is reused UNCHANGED; the corpus, which was a host
  mount locally, is git-cloned by an initContainer in the cluster. Real-cloud,
  operator-applied: every apply step is gated + reconfirmed.
---

# KG S3-shared index — Stage 2 (Infomaniak K8s deploy)

> Stage 1 proved the publish loop locally (Docker + MinIO). Stage 2 runs it in
> the cloud: a nightly CronJob on `pck-7e3mues` rebuilds the memory-free shared
> base and publishes it to Infomaniak Object Storage, so the shared index
> self-freshens without a developer running `kg:publish`.

## 1. Goal, scope, non-goals

**Goal.** A scheduled K8s CronJob on the real Infomaniak cluster publishes the
shared KG base (specs + governance, memory-free) to an Infomaniak S3 bucket. Dev
machines' local MCP servers fetch that base (Stage-1 `loadServingIndex`) + merge
their local memory. Prove the full Docker -> GHCR -> K8s -> Infomaniak path on a
zero-stakes internal workload.

**In scope.**

- Push the Stage-1 image to GHCR (private): `ghcr.io/de-braighter/devloop-kg`.
- Create the Infomaniak Object Storage bucket (directly via S3 API; terraform
  authored for the record).
- K8s manifests in `layers/platform/k8s/kg-publish/`: namespace, secrets,
  imagePullSecret, the CronJob (initContainer git-clone + the publish container).
- Apply to `pck-7e3mues` (gated, operator/me, reconfirmed per step) + a manual
  verification run.

**Out of scope / deferred.**

- Any devloop code or image change — the Stage-1 image is reused verbatim.
- A remote (HTTP/SSE) MCP service — the MCP server stays stdio-local per machine.
- Wiring each dev machine's MCP server to the cloud bucket — that's just setting
  `KG_S3_*` env locally (already supported by Stage 1); documented, not built.
- Multi-env (staging/prod split), autoscaling, alerting — single nightly job.
- Memory in the cloud — structurally impossible here (see §6).

## 2. Decisions (settled in brainstorming, 2026-05-31)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Deploy target | The real Infomaniak cluster `pck-7e3mues` (current kubeconfig context). Operator-applied; every apply gated + reconfirmed. |
| D2 | Image registry | **GHCR**, private — `ghcr.io/de-braighter/devloop-kg:<git-sha>`; push + pull + clone all via the one `GITHUB_TOKEN` (write:packages + repo). |
| D3 | Image changes | **None.** Stage-1 image reused; the corpus comes from an initContainer clone, not the image. |
| D4 | Corpus in-cluster | An **initContainer** (`alpine/git`) clones `de-braighter/workbench` -> `/cluster` and `de-braighter/specs` -> `/cluster/layers/specs` into a shared `emptyDir`; the publish container sets `DEVLOOP_CLUSTER_ROOT=/cluster`. |
| D5 | Bucket | Created directly via S3 API (`aws s3api`/`mc`) with the Infomaniak keypair — no tofu (not installed). `s3-bucket` terraform usage authored in `layers/platform` for the record. |
| D6 | Secrets at apply | Created via `kubectl create secret` from the gitignored cred file — no SOPS private key needed for the apply. SOPS-encrypted manifests committed to `layers/platform/k8s/kg-publish/` for the record (ADR-020). |
| D7 | Schedule | Nightly `0 3 * * *` (UTC). Manual trigger for verification. |
| D8 | Namespace | `devloop` on `pck-7e3mues`. |

## 3. Architecture

```mermaid
flowchart TB
  subgraph build["build + push (local, gated step 1)"]
    IMG[Stage-1 Dockerfile] -->|GITHUB_TOKEN, BuildKit secret| GHCR[(ghcr.io/de-braighter/devloop-kg:sha PRIVATE)]
  end
  subgraph cluster["pck-7e3mues / namespace devloop (gated step 3)"]
    CRON[CronJob kg-publish 0 3 * * *] --> POD
    subgraph POD["Job pod"]
      INIT["initContainer alpine/git\nclone workbench -> /cluster\nclone specs -> /cluster/layers/specs"] --> MAIN["container: devloop-kg image\nkg:publish, DEVLOOP_CLUSTER_ROOT=/cluster"]
    end
    SEC1[Secret kg-s3]:::s --> MAIN
    SEC2[Secret github-token]:::s --> INIT
    SEC3[Secret ghcr dockerconfigjson]:::s -.imagePull.-> MAIN
    GHCR -.pull.-> MAIN
  end
  MAIN -->|publishBase| S3[(Infomaniak Object Storage\nde-braighter-kg-index-prod)]
  classDef s fill:#fee;
```

- The pod is two containers sharing an `emptyDir` at `/cluster`:
  - **initContainer `clone`** (`alpine/git`): `git clone --depth 1 https://x-access-token:$GITHUB_TOKEN@github.com/de-braighter/workbench /cluster` then `... /de-braighter/specs /cluster/layers/specs`. Token from `Secret/github-token`.
  - **container `publish`** (`ghcr.io/de-braighter/devloop-kg:<sha>`): runs the image default (`kg:publish`), env `DEVLOOP_CLUSTER_ROOT=/cluster` + all `KG_S3_*` from `Secret/kg-s3`. No `DEVLOOP_MEMORY_DIR` (no memory in the cloud).
- `imagePullSecrets: [ghcr]` on the pod to pull the private image.
- Resource limits: requests `cpu: 100m, mem: 256Mi`, limits `cpu: 500m, mem: 512Mi` (short job, ~400-node build). `restartPolicy: OnFailure`, `backoffLimit: 2`, `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 3`, `concurrencyPolicy: Forbid`.

## 4. Files & resources created

- **GHCR:** `ghcr.io/de-braighter/devloop-kg:<git-sha>` (+ `:latest`), private.
- **`layers/platform/k8s/kg-publish/`** (new kustomize component):
  - `namespace.yaml` (devloop), `cronjob.yaml`, `kustomization.yaml`.
  - `secret.kg-s3.sops.yaml`, `secret.github-token.sops.yaml`, `secret.ghcr.sops.yaml` — SOPS-encrypted, committed for the record (decrypt-at-apply is the founder's age key; for *this* apply we `kubectl create secret` directly).
  - `README.md` — apply runbook.
- **`layers/platform/terraform/`** — a `kg-index` bucket usage of the `s3-bucket` module (env `prod`), authored for the record (not applied; tofu not installed).
- **Infomaniak Object Storage:** bucket `de-braighter-kg-index-prod`.
- **On `pck-7e3mues`:** namespace `devloop`; secrets `kg-s3`, `github-token`, `ghcr`; CronJob `kg-publish`.

## 5. Credentials & security

- **Handoff:** Infomaniak S3 creds in a **gitignored** `domains/devloop/.env.infomaniak` (`KG_S3_ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION`). Read at apply, never echoed. `GITHUB_TOKEN` from the existing env.
- **In-cluster:** the PAT lives in `Secret/github-token` (clone) + `Secret/ghcr` (pull); S3 creds in `Secret/kg-s3`. Standard k8s Secret (base64, namespace-scoped). The committed manifests are **SOPS-encrypted** (ADR-020; `encrypted_regex: ^(data|stringData)$`, age recipient in `k8s/.sops.yaml`) so no plaintext secret is committed.
- **No secret in the image** — Stage 1 already strips the build token; runtime secrets are k8s Secrets, not baked.
- **Apply gates:** four reconfirmed steps (§7). I never apply to the real cluster, create the bucket, or push the image without a fresh go.

## 6. Why memory is structurally absent from the cloud base

The initContainer clones only `de-braighter/workbench` + `de-braighter/specs` — the *shared* repos. The per-developer memory dir (`~/.claude/.../memory`) is on no machine the pod can see, and `DEVLOOP_MEMORY_DIR` is unset in the pod, so `buildBaseIndex` reads specs + governance only. Personal memory **cannot** reach the shared bucket. The Stage-1 shared-base/local-overlay split is what makes a cloud publisher privacy-safe by construction.

## 7. Execution plan (gated; each step reconfirmed before running)

1. **Build + push image** — build the Stage-1 Dockerfile (BuildKit secret for `npm ci`), tag `ghcr.io/de-braighter/devloop-kg:<sha>`, `docker push`. Verify the package is private.
2. **Create the bucket** — `aws s3api create-bucket`/`mc mb` against the Infomaniak endpoint with the keypair. Verify it exists + is empty.
3. **Apply to the cluster** — confirm `kubectl config current-context == kubernetes-admin@pck-7e3mues`; create namespace + the three secrets (from creds, not committed plaintext) + apply the CronJob. `kubectl --dry-run=client` first to validate shape locally.
4. **Verify** — `kubectl create job kg-publish-manual --from=cronjob/kg-publish -n devloop`; watch it Complete; check logs for `kg publish: nodes=NNN …`; confirm the object lands in the bucket (`mc ls`/`aws s3 ls`). Expected NNN ≈ the memory-free base (~372).

## 8. Verification & rollback

- **Success:** the manual Job completes, logs the publish, and the bucket contains `kg-index.json`. A dev machine with `KG_S3_*` pointed at the bucket fetches it via `loadServingIndex`.
- **Rollback:** delete the CronJob/namespace (`kubectl delete -k k8s/kg-publish` or `kubectl delete ns devloop`); delete the bucket object/bucket; delete the GHCR image tag. Nothing else on the cluster is touched (own namespace, no shared resources).
- **Idempotency:** re-applying overwrites the same-named resources; re-running the job overwrites the same S3 key. Safe to repeat.

## 9. Governance

No kernel change; no devloop code change. The CronJob is internal tooling on the
platform. "Store generators, derive graphs": the bucket object is a published
derived projection, rebuilt nightly from the cloned generators; never a source of
truth (dev machines retain the local-build fallback). Operator-applied to real
infra with gated, reconfirmed steps + a clean rollback, on a no-PHI, no-user,
own-namespace workload — the deliberately low-stakes pipe-clean target.
