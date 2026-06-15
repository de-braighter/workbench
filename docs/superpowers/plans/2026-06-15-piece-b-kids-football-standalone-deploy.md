# Piece B — Standalone kids-football app + Infomaniak dev deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone, self-contained kids-football app (the ADR-234 "Piece B") and deploy it as a working demo to the Infomaniak dev environment at `kids.dev.exercir.ch`, replacing/augmenting the previous test deployment.

**Architecture:** A new Nx Angular app `apps/pack-kids-football-app` reuses the `@de-braighter/pack-kids-football-ui` lib barrel (picker + `KIDS_FOOTBALL_ROUTES` + `provideKidsFootballI18n`), sets `data-skin="club-grass"` on `<html>` (the published Club Grass skin themes it — no `--cg-*` projection), and provides `KF_API_BASE_URL=''` so the API client calls same-origin `/kids-football/*`. It ships as **two container images**: an **nginx SPA** that serves the app and reverse-proxies `/kids-football/*` to a separate **in-memory `pack-kids-football-api`** image (no Postgres — demo data auto-seeds, resets on restart). Deployed to the existing `exercir` namespace on cluster `pck-7e3mues`, reusing the `exercir-gateway` + `*.dev.exercir.ch` wildcard TLS cert via a new HTTPRoute.

**Tech Stack:** Nx 22 + Angular 21 (standalone, signals, OnPush) + Transloco i18n; NestJS 10 (in-memory mode); Docker (multi-stage, nginx 1.27 + node 20-alpine); GHCR (`ghcr.io/de-braighter/*`); Envoy Gateway API + kustomize + kubectl on Infomaniak Kubernetes Service.

**Scope decisions (founder-approved 2026-06-15):**
- **Additive** — do NOT remove kids-football from the shared `pack-football-visual-editor` host in this arc (that host is the *currently deployed* football editor; leave it untouched). The standalone app is a new, parallel app.
- **In-memory API** — the demo runs `pack-kids-football-api` with `PACK_KIDS_FOOTBALL_DB` unset (auto-seeds 2 stub clubs; data resets on pod restart). No Postgres, no PHI.
- **Target** `kids.dev.exercir.ch` (under the existing `*.dev.exercir.ch` wildcard cert + DNS — no new cert/DNS). Additive + reversible; the founder can repoint the primary dev URL later.

---

## ⚠️ Cross-cutting conventions (READ FIRST)

### Blocker: cluster is currently unreachable from the build machine
`kubectl` against `kubernetes-admin@pck-7e3mues` fails `x509: certificate signed by unknown authority` — the working kubeconfig (`~/.kube/exercir-dev.kubeconfig` per `layers/platform/docs/getting-started/infomaniak-bootstrap.md`) is **not present**; only a stale `~/.kube/config`. The SOPS age key **is** present (`~/.config/sops/age/keys.txt`). **Part D (image push + `kubectl apply`) cannot run until the founder restores cluster access.** Parts A–C (the app, the containers, local `docker compose` verification, the K8s manifests) are fully buildable + verifiable locally with **zero cluster contact** — do all of that first; Part D is the gated tail.

### Worktree-only git, off `origin/main`
- exercir: `git -C domains/exercir worktree add ../../exercir-wt-pieceb -b feat/kids-football-standalone-app origin/main`
- platform: `git -C layers/platform worktree add ../../platform-wt-kids-football -b feat/kids-football-dev-deploy origin/main`
- (`../../<name>` → `D:/development/projects/<name>`, short path for Windows MAX_PATH.) ALL git ops in the worktree. Cleanup: `git -C <repo> worktree remove --force <path>` then `worktree prune` + `rm -rf` if a Nx `.db` lock holds the dir.

### Gates without masking pipes
`npm run ci:local > /tmp/log 2>&1; echo "EXIT=$?"` (a pipe returns the pipe's exit code). `@nx/angular:unit-test` rejects spec filters → run the full project with `NX_DAEMON=false`. Each repo has a **pre-push hook** (`nx affected -t lint`) — never bypass it. `export GITHUB_TOKEN=…` (read:packages) before any `npm install` in exercir.

### Per-slice process (the established rhythm)
Each Part = its own PR + verifier wave + merge. exercir PRs: `reviewer` + `qa-engineer` + `exercir-charter-checker` (+ `a11y-pro` if UI tokens change — Part A reuses the shipped skin, so a11y is light). platform PRs: `reviewer` + `qa-engineer` + (deploy manifests) a `local-ci`-style kustomize-build/dry-run check. Open the PR before the wave; push first; fix blockers; squash-merge.

---

## File Structure

**Part A — exercir (`domains/exercir`):**
- Create `apps/pack-kids-football-app/` — the new Nx Angular app:
  - `project.json` (tags `scope:pack-kids-football type:application platform:browser`, prod budget)
  - `src/main.ts`, `src/index.html` (`<html data-skin="club-grass">`), `src/styles.css` (@import skin + `--kf-*` partial)
  - `src/app/app.component.ts` (root, `<router-outlet/>`), `src/app/app.config.ts` (providers), `src/app/app.routes.ts` (picker + tenant subtree)
  - `tsconfig.json`, `tsconfig.app.json`, `tsconfig.spec.json`
- Create `apps/pack-kids-football-app/Dockerfile` (nginx SPA + reverse-proxy) + `nginx.conf` + `.dockerignore`

**Part B — exercir containers:**
- Create `apps/pack-kids-football-api/Dockerfile` (in-memory NestJS) + `.dockerignore`
- Create `apps/pack-kids-football-app/docker-compose.demo.yml` (local two-container demo)

**Part C — platform (`layers/platform`):**
- Create `k8s/kids-football/{namespace-note.md,kf-app.yaml,kf-api.yaml,httproute.yaml,kustomization.yaml}` (in the `exercir` namespace; reuse gateway + cert)
- Create `k8s/kids-football/README.md` (manual apply runbook)

---

## PART A — The standalone Angular app (`domains/exercir`)

**Branch:** `feat/kids-football-standalone-app`. **Worktree:** `../../exercir-wt-pieceb`.

### Task A1: Scaffold the Nx app

**Files:** Create `apps/pack-kids-football-app/` (via generator, then prune).

- [ ] **Step 1:** From the worktree root, generate a minimal standalone Angular app:
```bash
NX_DAEMON=false npx nx g @nx/angular:application pack-kids-football-app \
  --directory=apps/pack-kids-football-app \
  --routing=true --standalone=true --style=css \
  --e2eTestRunner=none --unitTestRunner=vitest --bundler=esbuild --skipTests=false --no-interactive
```
Expected: app generated under `apps/pack-kids-football-app/`. If the generator name/flags drift, mirror `apps/pack-football-visual-editor` structure by hand.

- [ ] **Step 2:** Edit `apps/pack-kids-football-app/project.json` — set the tags exactly:
```json
"tags": ["scope:pack-kids-football", "type:application", "platform:browser"]
```
and the prod `build` configuration budgets (4 eager i18n catalogs land in the bundle — match the host's bumped ceiling):
```json
"budgets": [
  { "type": "initial", "maximumWarning": "1.3mb", "maximumError": "1.6mb" },
  { "type": "anyComponentStyle", "maximumWarning": "6kb", "maximumError": "9kb" }
]
```
(The standalone bundles kids-football + 4 eager Transloco catalogs but **none** of the pack-football/eyecatcher code, so it is smaller than the shared host overall; the `initial` ceiling is generous to start, tighten after the first prod build.)

- [ ] **Step 3:** Confirm nx boundary tags will FORBID a pack-football edge: `domains/exercir/eslint.config.mjs` already constrains `scope:pack-kids-football` → `scope:pack-kids-football` + substrate/design-system only. No change needed; Task A6 verifies zero `scope:pack-football` import.
- [ ] **Step 4: Commit** — `feat(kids-football): scaffold standalone pack-kids-football-app (ADR-234 Piece B)`.

### Task A2: Root component + index.html (data-skin on `<html>`)

**Files:** `apps/pack-kids-football-app/src/index.html`, `src/app/app.component.ts`

- [ ] **Step 1:** `src/index.html` — set `data-skin="club-grass"` on `<html>` so the published skin themes the entire app:
```html
<!doctype html>
<html lang="en" data-skin="club-grass">
  <head>
    <meta charset="utf-8" />
    <title>Club Grass — Kids Football</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/x-icon" href="favicon.ico" />
  </head>
  <body>
    <kf-root></kf-root>
  </body>
</html>
```
- [ ] **Step 2:** `src/app/app.component.ts` — minimal root:
```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'kf-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppComponent {}
```
- [ ] **Step 3: Commit** — `feat(kids-football): standalone root + data-skin html`.

### Task A3: Global styles (published skin + `--kf-*` partial)

**Files:** `apps/pack-kids-football-app/src/styles.css`

- [ ] **Step 1:** `src/styles.css` — load the floor + the published Club Grass skin + the pack-extension partial globally (esbuild inlines the workspace `@import`; node_modules `@import` resolves the package):
```css
/* The :root floor (default tokens) + the published Club Grass skin overlay,
   which themes the whole app because <html> carries data-skin="club-grass". */
@import '@de-braighter/design-system-css/tokens.css';
@import '@de-braighter/design-system-css/skins/skin-club-grass.css';
@import '../../../libs/pack-kids-football-ui/src/lib/club-grass-pack-tokens.css';

html, body { margin: 0; min-height: 100vh; background: var(--color-bg, #f5f3ec); }
```
- [ ] **Step 2:** In `project.json` build options, ensure `"styles": ["apps/pack-kids-football-app/src/styles.css"]`.
- [ ] **Step 3: Commit** — `feat(kids-football): global published-skin styles for the standalone app`.

### Task A4: Routes (picker + tenant subtree)

**Files:** `apps/pack-kids-football-app/src/app/app.routes.ts`

Context: mirror the shared host's three kids-football routes (`apps/pack-football-visual-editor/src/app/app.routes.ts` lines 30–65), minus everything pack-football.

- [ ] **Step 1:**
```ts
import { Route } from '@angular/router';
import { ClubPickerPageComponent, KIDS_FOOTBALL_ROUTES } from '@de-braighter/pack-kids-football-ui';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: '/kids-football' },
  // Eager picker (tenant-less landing). Shares the root TranslocoService.
  { path: 'kids-football', component: ClubPickerPageComponent },
  // Tenant subtree (sign-in / setup / shell + all admin/coach pages).
  { path: 't/:tenant/p/kids-football', children: KIDS_FOOTBALL_ROUTES as Route[] },
];
```
- [ ] **Step 2: Commit** — `feat(kids-football): standalone routes (picker + tenant subtree)`.

### Task A5: App config (providers — same-origin API + i18n)

**Files:** `apps/pack-kids-football-app/src/app/app.config.ts`, `src/main.ts`

- [ ] **Step 1:** `src/app/app.config.ts`:
```ts
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideKidsFootballI18n, KF_API_BASE_URL } from '@de-braighter/pack-kids-football-ui';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideRouter(appRoutes, withComponentInputBinding()),
    // Same-origin: the API client calls `/kids-football/*`, proxied by nginx
    // to the in-memory pack-kids-football-api (KF_API_BASE_URL default is the
    // dev :3150 cross-origin URL — override to '' for the deployed same-origin).
    { provide: KF_API_BASE_URL, useValue: '' },
    ...provideKidsFootballI18n(),
  ],
};
```
(Match the host's change-detection strategy — if the host does NOT use zoneless, drop `provideZonelessChangeDetection` and the import; verify against `apps/pack-football-visual-editor/src/app/app.config.ts` at execution.)

- [ ] **Step 2:** `src/main.ts`:
```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
```
- [ ] **Step 3: Commit** — `feat(kids-football): standalone app config (KF_API_BASE_URL='' + i18n)`.

### Task A6: Build + local serve verification

- [ ] **Step 1: Build (catches budget + boundary)** — `NX_DAEMON=false npx nx build pack-kids-football-app > /tmp/kfapp-build.log 2>&1; echo "EXIT=$?"`. Expected: success; **zero** `scope:pack-football` boundary error. If a pack-football import sneaks in (e.g. a transitive ui-lib dep), it FAILS the boundary lint — fix the import.
- [ ] **Step 2: Serve + browser-verify** — run the in-memory api (`PORT=3150 npx nx serve pack-kids-football-api`) + the new app (`npx nx serve pack-kids-football-app`, note its dev port). BUT note: `KF_API_BASE_URL=''` means the dev app calls same-origin `/kids-football/*`, which the Angular dev server does NOT proxy to :3150 — so for **dev-server** verification, either (a) add a dev proxy (`proxy.conf.json` mapping `/kids-football` → `http://localhost:3150`) **or** (b) defer the live API check to Part B's `docker compose` (which has the real nginx proxy). Recommended: add `apps/pack-kids-football-app/proxy.conf.json`:
```json
{ "/kids-football": { "target": "http://localhost:3150", "secure": false } }
```
and wire it into the serve target (`"proxyConfig": "apps/pack-kids-football-app/proxy.conf.json"`). Then browser-verify: picker lists 2 demo clubs, sign in as a coach/admin, accent is **green**, 4-lang switch works.
- [ ] **Step 3: Gate** — `npm run ci:local > /tmp/kfapp-ci.log 2>&1; echo "EXIT=$?"` (build + lint + test all projects incl. the new app). Green.
- [ ] **Step 4: PR + verifier wave + merge** (reviewer + qa-engineer + exercir-charter-checker). Charter note: additive new app, in-memory demo, no PHI, no demo-mode regression; reuses the published skin (no new `--cg-*`).

---

## PART B — Containerization + local Docker demo (`domains/exercir`)

**Same branch or a follow-up PR.**

### Task B1: The in-memory API Dockerfile

**Files:** Create `apps/pack-kids-football-api/Dockerfile`, `apps/pack-kids-football-api/.dockerignore`

Context: there is no backend Dockerfile yet. Build the NestJS app with Nx, run it on node. In-memory mode = `PACK_KIDS_FOOTBALL_DB` unset.

- [ ] **Step 1:** `apps/pack-kids-football-api/Dockerfile` (build context = exercir repo root; needs `GITHUB_TOKEN` build secret for the `@de-braighter/*` npm ci):
```dockerfile
# syntax=docker/dockerfile:1.7
# Build: docker build -f apps/pack-kids-football-api/Dockerfile \
#   --secret id=github_token,env=GITHUB_TOKEN \
#   -t ghcr.io/de-braighter/pack-kids-football-api:dev .
FROM node:20-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=github_token \
    GITHUB_TOKEN="$(cat /run/secrets/github_token)" npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npx nx build pack-kids-football-api --skip-nx-cache

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3150
# Nx outputs the bundled api under dist/apps/pack-kids-football-api (verify the
# exact path at execution: `npx nx build pack-kids-football-api` then inspect
# the `dist/` location printed in the build output / project.json outputPath).
COPY --from=build /workspace/dist/apps/pack-kids-football-api ./
# Runtime deps: if the build is a self-contained bundle (esbuild/webpack), no
# node_modules copy is needed; if it externalizes deps, also COPY the pruned
# node_modules. Verify which at execution from the build output.
USER node
EXPOSE 3150
# PACK_KIDS_FOOTBALL_DB intentionally UNSET → in-memory, auto-seeds 2 stub clubs.
CMD ["node", "main.js"]
```
> At execution, confirm the Nx `outputPath` for `pack-kids-football-api` (read its `project.json` build target) and whether the output is self-contained or externalizes node_modules — adjust the `COPY` lines accordingly. The api's `main.ts` reads `PORT` (default 3150) and `enableCors`.

- [ ] **Step 2:** `.dockerignore` — mirror `apps/pack-football-visual-editor/.dockerignore` (exclude node_modules, dist, .nx, .angular, .git, *.md, coverage).
- [ ] **Step 3:** Build it: `export DOCKER_BUILDKIT=1; docker build -f apps/pack-kids-football-api/Dockerfile --secret id=github_token,env=GITHUB_TOKEN -t pack-kids-football-api:local .` → run `docker run --rm -p 3150:3150 pack-kids-football-api:local` → `curl -s localhost:3150/kids-football/teams` (with a tenant header — or just confirm it listens + logs "listening on :3150" + the demo seed). Commit.

### Task B2: The SPA nginx Dockerfile + same-origin proxy

**Files:** Create `apps/pack-kids-football-app/Dockerfile`, `apps/pack-kids-football-app/nginx.conf`, `.dockerignore`

- [ ] **Step 1:** `apps/pack-kids-football-app/nginx.conf` — the critical same-origin split. The API client calls `/kids-football/<resource>` and the SPA picker route is exactly `/kids-football`:
```nginx
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;

  # Security headers (mirror pack-football-visual-editor/nginx.conf).
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  location = /healthz { return 200 "ok\n"; add_header Content-Type text/plain; }

  # The SPA picker route is EXACTLY /kids-football → serve index.html.
  location = /kids-football { try_files /index.html =404; }

  # API calls are /kids-football/<resource> → proxy to the api container.
  # No trailing slash on proxy_pass: the api controllers are
  # @Controller('kids-football/<resource>'), so the full path is preserved.
  location /kids-football/ {
    proxy_pass http://kf-api:3150;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Everything else is an Angular client-side route (/t/:tenant/..., assets) →
  # serve the asset if it exists, else fall back to the SPA.
  location / { try_files $uri $uri/ /index.html; }
}
```
> `kf-api` is the Docker-compose service name / K8s service name (Part B3 / Part C). In compose it resolves via the compose network; in K8s via the `kf-api` Service DNS.

- [ ] **Step 2:** `apps/pack-kids-football-app/Dockerfile` (mirror the visual-editor one; build the SPA, serve via nginx on 8080):
```dockerfile
# syntax=docker/dockerfile:1.7
# Build: docker build -f apps/pack-kids-football-app/Dockerfile \
#   --secret id=github_token,env=GITHUB_TOKEN \
#   -t ghcr.io/de-braighter/pack-kids-football-app:dev .
FROM node:20-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=github_token \
    GITHUB_TOKEN="$(cat /run/secrets/github_token)" npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npx nx build pack-kids-football-app --skip-nx-cache

FROM nginx:1.27-alpine AS runtime
COPY apps/pack-kids-football-app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist/apps/pack-kids-football-app/browser /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q --spider http://localhost:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
```
> Verify the Nx SPA `outputPath` (`dist/apps/pack-kids-football-app/browser`) from the build output at execution.

- [ ] **Step 3:** `.dockerignore` — mirror the visual-editor's. Commit.

### Task B3: docker-compose demo + local end-to-end verify

**Files:** Create `apps/pack-kids-football-app/docker-compose.demo.yml`

- [ ] **Step 1:**
```yaml
# Local self-contained demo: in-memory api + nginx SPA (same-origin).
# Run:  GITHUB_TOKEN=ghp_... docker compose -f apps/pack-kids-football-app/docker-compose.demo.yml up --build
# Open: http://localhost:4300/kids-football
services:
  kf-api:
    build:
      context: .
      dockerfile: apps/pack-kids-football-api/Dockerfile
      secrets: [github_token]
    environment:
      PORT: "3150"
      # PACK_KIDS_FOOTBALL_DB unset → in-memory, auto-seeds 2 stub clubs.
  kf-app:
    build:
      context: .
      dockerfile: apps/pack-kids-football-app/Dockerfile
      secrets: [github_token]
    ports: ["4300:8080"]
    depends_on: [kf-api]
secrets:
  github_token:
    environment: GITHUB_TOKEN
```
- [ ] **Step 2: Build + run + verify** — `export GITHUB_TOKEN=ghp_…; docker compose -f apps/pack-kids-football-app/docker-compose.demo.yml up --build -d`. Then Playwright/manual at `http://localhost:4300/kids-football`: picker lists 2 demo clubs; sign in (e.g. Anna Müller, Club Admin); accent renders **green** (`oklch(0.555 0.12 148)`); the API works (members/teams load via the same-origin `/kids-football/*` proxy — NOT a 404/CORS error); 4-language switch works. Screenshot → `de-braighter/docs/kids-football-standalone-docker-proof.png`. `docker compose … down`.
- [ ] **Step 3: PR + wave + merge** (Parts A+B can be one PR or two). exercir-charter: in-memory demo, no PHI, additive.

---

## PART C — K8s manifests for the dev deploy (`layers/platform`)

**Branch:** `feat/kids-football-dev-deploy`. **Worktree:** `../../platform-wt-kids-football`. **No cluster contact** — author + `kustomize build` + `kubectl --dry-run=client` only.

Reuse the existing `exercir` namespace + `exercir-gateway` + the `*.dev.exercir.ch` wildcard cert (covers `kids.dev.exercir.ch`). Add: kf-app Deployment+Service, kf-api Deployment+Service, one HTTPRoute.

### Task C1: kf-api Deployment + Service

**Files:** Create `layers/platform/k8s/kids-football/kf-api.yaml`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: kf-api, namespace: exercir, labels: { app: kf-api } }
spec:
  replicas: 1
  selector: { matchLabels: { app: kf-api } }
  template:
    metadata: { labels: { app: kf-api } }
    spec:
      imagePullSecrets: [{ name: ghcr-pull-secret }]
      containers:
        - name: kf-api
          image: ghcr.io/de-braighter/pack-kids-football-api:dev   # tag pinned at apply
          imagePullPolicy: Always
          ports: [{ containerPort: 3150, name: http }]
          env:
            - { name: NODE_ENV, value: production }
            - { name: PORT, value: "3150" }
          # PACK_KIDS_FOOTBALL_DB unset → in-memory demo (no Postgres).
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { cpu: 500m, memory: 512Mi }
          readinessProbe: { httpGet: { path: /kids-football/teams, port: 3150, httpHeaders: [{ name: X-Tenant, value: probe }] }, initialDelaySeconds: 10, periodSeconds: 10 }
          livenessProbe:  { httpGet: { path: /kids-football/teams, port: 3150, httpHeaders: [{ name: X-Tenant, value: probe }] }, initialDelaySeconds: 30, periodSeconds: 30 }
---
apiVersion: v1
kind: Service
metadata: { name: kf-api, namespace: exercir }
spec:
  selector: { app: kf-api }
  ports: [{ port: 3150, targetPort: 3150, protocol: TCP }]
```
> Verify a cheap unauthenticated 200 endpoint for the probe at execution (the api may 401 without auth — if so, add a `/healthz` to `pack-kids-football-api` in Part B, or probe a TCP socket instead of HTTP). `ghcr-pull-secret` already exists in the `exercir` ns (created by the existing deploy) — reuse it.

### Task C2: kf-app Deployment + Service
**Files:** Create `layers/platform/k8s/kids-football/kf-app.yaml` — same shape, image `ghcr.io/de-braighter/pack-kids-football-app:dev`, containerPort **8080**, Service port 80→targetPort 8080, readiness/liveness `httpGet /healthz :8080`. (The nginx in this image proxies `/kids-football/` → the `kf-api` Service by DNS name `kf-api:3150` — matches `nginx.conf`.)

### Task C3: HTTPRoute on kids.dev.exercir.ch
**Files:** Create `layers/platform/k8s/kids-football/httproute.yaml`
```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: kids-football, namespace: exercir }
spec:
  parentRefs: [{ name: exercir-gateway }]   # reuse the existing gateway
  hostnames: ["kids.dev.exercir.ch"]
  rules:
    - matches: [{ path: { type: PathPrefix, value: / } }]
      backendRefs: [{ name: kf-app, port: 80 }]
```
> The gateway's dev listener is `*.dev.exercir.ch` (wildcard) with the `exercir-ch-wildcard-tls` cert — `kids.dev.exercir.ch` is covered, so **no new cert/listener**. Confirm the gateway's `allowedRoutes` admits this HTTPRoute (same namespace `exercir` → yes). All `/kids-football/*` API routing is handled *inside* the kf-app nginx (same-origin), so the HTTPRoute is a single catch-all → kf-app.

### Task C4: kustomization + README + local validation
**Files:** Create `layers/platform/k8s/kids-football/kustomization.yaml` (resources: kf-api.yaml, kf-app.yaml, httproute.yaml; `namespace: exercir`; `images:` entries for both with `newTag: dev`) + `README.md` (the manual apply runbook, mirroring `kg-publish/README.md`).
- [ ] Validate locally (no cluster): `kubectl kustomize layers/platform/k8s/kids-football > /tmp/kf.rendered.yaml && kubectl apply --dry-run=client -f /tmp/kf.rendered.yaml`. Expected: renders + client-dry-run OK.
- [ ] **PR + wave + merge** (platform). Manifests-only, no cluster contact.

---

## PART D — ⛔ GATED: build, push, deploy (requires restored cluster access)

**Every step here is a live action — reconfirm with the founder before running. Cannot start until `kubectl` reaches `pck-7e3mues` (see the Blocker).**

### Task D1: ⛔ Build + push both images to GHCR
- [ ] `export GITHUB_TOKEN=ghp_…` (write:packages); `SHA=$(git -C domains/exercir rev-parse --short HEAD)`.
- [ ] Build both (from the exercir worktree root, `DOCKER_BUILDKIT=1`, `--secret id=github_token,env=GITHUB_TOKEN`), tag each `:dev` and `:$SHA`:
  - `ghcr.io/de-braighter/pack-kids-football-app:{dev,$SHA}`
  - `ghcr.io/de-braighter/pack-kids-football-api:{dev,$SHA}`
- [ ] `echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$(gh api user -q .login)" --password-stdin` → push all 4 tags. Confirm packages exist + **private** under `de-braighter`.

### Task D2: ⛔ Restore cluster access + safety interlock
- [ ] Founder restores `~/.kube/exercir-dev.kubeconfig` (or the CA in `~/.kube/config`); `export KUBECONFIG=~/.kube/exercir-dev.kubeconfig`.
- [ ] Interlock: `CTX=$(kubectl config current-context); test "$CTX" = "kubernetes-admin@pck-7e3mues" && echo OK || { echo ABORT; exit 1; }`
- [ ] Read-only baseline: `kubectl -n exercir get deploy,svc,httproute,gateway` — confirm the existing football-editor deployment + gateway, and that `kf-app`/`kf-api` do NOT yet exist (or are the previous test version to replace).

### Task D3: ⛔ Apply (pin image tags, no tracked-file mutation per ADR-143)
- [ ] Stage + pin + apply (mirror `infomaniak-bootstrap.md` Step 8 Option B):
```bash
stage="$(mktemp -d)"; cp -R layers/platform/k8s/kids-football "${stage}/o"
( cd "${stage}/o" && kustomize edit set image \
    ghcr.io/de-braighter/pack-kids-football-app=ghcr.io/de-braighter/pack-kids-football-app:$SHA \
    ghcr.io/de-braighter/pack-kids-football-api=ghcr.io/de-braighter/pack-kids-football-api:$SHA )
kubectl kustomize "${stage}/o" | kubectl apply -f -
rm -rf "${stage}"
```
- [ ] `kubectl -n exercir rollout status deploy/kf-app --timeout=5m && kubectl -n exercir rollout status deploy/kf-api --timeout=5m`

### Task D4: ⛔ Verify the live deploy
- [ ] `kubectl -n exercir get pods -l app=kf-app && kubectl -n exercir logs deploy/kf-api | tail` (expect the demo-seed log).
- [ ] DNS: confirm `kids.dev.exercir.ch` resolves (the `*.dev.exercir.ch` wildcard A record covers it); if not, add the A record → gateway IP.
- [ ] Browser: `https://kids.dev.exercir.ch/kids-football` — picker, sign-in, **green accent**, API works (members load via same-origin), 4-lang switch. Screenshot → `de-braighter/docs/kids-football-dev-deploy-proof.png`.
- [ ] **Rollback:** `kubectl -n exercir delete -f /tmp/kf.rendered.yaml` (removes only kf-app/kf-api/the HTTPRoute; the football-editor deployment is untouched).

---

## Self-Review

**Spec coverage:** standalone app (A1–A5) · data-skin on `<html>` (A2) · published-skin theming, no `--cg-*` (A3) · `KF_API_BASE_URL=''` same-origin (A5) · in-memory api container (B1) · nginx same-origin proxy with the exact `/kids-football` picker-vs-`/kids-football/` API split (B2) · self-contained docker-compose demo, port 4300 (B3) · K8s dev deploy reusing gateway + `*.dev.exercir.ch` cert (C1–C4) · gated build/push/apply + rollback (D). Additive (shared host untouched); in-memory (no PHI/Postgres). ✓

**Placeholder scan:** the deliberate "verify at execution" notes (Nx `outputPath`, the probe endpoint, zoneless-or-not, the Nx generator flags) are real environment reads with a stated fallback (mirror `pack-football-visual-editor`), not unfilled TBDs.

**Consistency:** the api is reached at `/kids-football/<resource>` everywhere (client paths, `@Controller` prefixes, nginx `location /kids-football/`, the probe paths). Service names `kf-api`/`kf-app` match across nginx.conf, docker-compose, and the K8s manifests. Images `ghcr.io/de-braighter/pack-kids-football-{app,api}` match across Dockerfiles, docker-compose, and kustomization. The picker route `/kids-football` (exact) vs the API prefix `/kids-football/` is handled by `location =` vs `location` in nginx.

**The hard blocker** (cluster unreachable) is isolated to Part D; A–C deliver a fully buildable + locally-verifiable standalone app + container demo + ready-to-apply manifests with zero cluster contact.
