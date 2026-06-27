# Tenant Management — Slice D2 (Herdbook Login UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Worktree off `domains/herdbook` `main` (now at the D1 merge `5e6e1bf`). The user-facing payoff: a human logs into herdbook with email+password and works the registry on a verified token — no dev-header spoofing.

**Goal:** Replace the dev-header auth shim with real token login in the herdbook Angular web app: a `/login` screen → `/auth/login` → an in-memory access token + a bearer interceptor → the registry works token-authenticated; a route guard redirects the unauthenticated to `/login`; the active tenant comes from the token.

**Architecture:** A signal-backed `AuthStore` holds the access token **in memory** (never localStorage — XSS-exfiltration hygiene); the refresh token is the substrate's **httpOnly·Secure·SameSite=Strict cookie** the browser manages (the dev proxy makes `/auth` same-origin with the app, so the Strict cookie is sent and the `WEB_ORIGIN` CSRF check passes). `AuthClient` wraps `/auth/login|select-tenant|refresh|logout|me` (all `withCredentials: true`). A `bearerInterceptor` replaces `devAuthInterceptor`: it attaches `Authorization: Bearer <token>` and on a 401 tries `/auth/refresh` once → retries, else routes to `/login`. A functional-CanActivate `authGuard` gates the app routes. **Scope = the durable plumbing + a minimal accessible login form** (the founder's incoming UI prototype reskins the form; the plumbing survives). **Org self-admin ("Settings → Team") is DEFERRED** (plan Task 6 — design-dependent + needs a new backend endpoint).

**Tech Stack:** Angular 18.2 standalone + signals (default zone.js), `ReactiveFormsModule`, `@de-braighter/design-system-css` tokens + the `.hb-*` class pattern (mirror `animal-form.component.ts`), `HttpClient` + functional interceptors, the published auth endpoints from D1.

**Spec:** ADR-211 (auth layer) + the umbrella §4 Slice D Task 5. Predecessor: D1 merged (`5e6e1bf`) — `/auth/*` + JWKS served live by the herdbook API.

---

## Repos & key facts (verified by the Explore sweep)

- Web app: `domains/herdbook/apps/web/`. Angular **18.2**, standalone, signals, **NOT zoneless** (default zone.js), `provideZoneChangeDetection({ eventCoalescing: true })`.
- **Dev shim to replace:** `apps/web/src/app/dev-auth.interceptor.ts` sets `x-tenant-id: b6c5d8e2-0001-4abc-9def-fedcba000001`, `x-pack-id: herdbook`, `x-user-id: 11111111-1111-4111-8111-111111111111`. Registered in `apps/web/src/app/app.config.ts`: `provideHttpClient(withInterceptors([devAuthInterceptor, localeInterceptor]))`.
- **Routing:** `apps/web/src/app/app.routes.ts` — lazy standalone routes, default redirect to `dashboard`, **no guards today**. Root layout `app.component.ts` (header nav + locale `<select>` + `<router-outlet/>`).
- **Proxy:** `apps/web/proxy.conf.json` proxies **only** `/api` → `http://localhost:3200` with `pathRewrite {"^/api":""}`. `/auth/*` + `/.well-known/*` are **NOT** proxied yet — D2 adds them (NO path rewrite: `/auth/login` must hit `:3200/auth/login`).
- **Design:** `@de-braighter/design-system-css` tokens (`styles.css` imports `tokens.css`, remaps `--hb-*`, dark mode). Form pattern = `apps/web/src/app/animal/animal-form.component.ts` (`ReactiveFormsModule`, `FormGroup`, computed-signal error states, `.hb-label/.hb-input/.hb-alert-error/.hb-btn-primary/.hb-btn-ghost`, `.grid-2`). No shared form-field wrapper — styles inline per form.
- **HTTP service pattern:** `@Injectable({ providedIn: 'root' })`, `inject(HttpClient)`, a `base` string + typed observables (e.g. `animal-api.service.ts`, `base = '/api/animals'`).
- **The login response shape (from D1's integration test, verified live):** `POST /auth/login {email,password}` → `200 { accessToken: string, user: { id, … } }` + a `Set-Cookie: substrate_rt=…; HttpOnly`. A single-tenant user's login **auto-binds** the tenant (the token is already tenant-scoped). `POST /auth/select-tenant {tenantId,packId}` (cookie + `Origin`) → `200 { accessToken }`. `POST /auth/refresh` (cookie + `Origin`) → `200 { accessToken }` + a rotated cookie. Wrong password → `401`.
- **The access token is a JWT** — claims include `tid` (tenantId), `pack` (packId), `sub` (userId), `tpid`, `roles`, `exp`. The UI may decode the payload (base64url, no verification needed client-side — display only) to show the active tenant/user.

---

## Task 1: Proxy `/auth` + `/.well-known` to the API

**Files:** Modify `apps/web/proxy.conf.json`.

- [ ] **Step 1:** Add two proxy entries (NO path rewrite, so the path passes through verbatim):
```json
{
  "/api": {
    "target": "http://localhost:3200",
    "secure": false,
    "changeOrigin": true,
    "pathRewrite": { "^/api": "" }
  },
  "/auth": {
    "target": "http://localhost:3200",
    "secure": false,
    "changeOrigin": true
  },
  "/.well-known": {
    "target": "http://localhost:3200",
    "secure": false,
    "changeOrigin": true
  }
}
```
- [ ] **Step 2:** Confirm the dev server picks it up (the `serve` target references `proxy.conf.json`). No test — config only.
- [ ] **Step 3: Commit** `chore(web): proxy /auth + /.well-known to the API (D2 login)`.

---

## Task 2: `AuthStore` — the in-memory token + auth-state signals

**Files:** Create `apps/web/src/app/auth/auth-store.ts` + `apps/web/src/app/auth/auth-store.spec.ts`.

The single source of truth for "am I logged in + who/where". Access token lives **only here** (in a signal, in memory) — page reload logs out (the refresh cookie re-establishes a session via an app-init refresh in Task 5; keep this store pure).

- [ ] **Step 1: Write the failing test** (`auth-store.spec.ts`):
```ts
import { TestBed } from '@angular/core/testing';
import { AuthStore } from './auth-store';

describe('AuthStore', () => {
  let store: AuthStore;
  beforeEach(() => { TestBed.configureTestingModule({}); store = TestBed.inject(AuthStore); });

  it('starts logged out', () => {
    expect(store.isAuthenticated()).toBe(false);
    expect(store.accessToken()).toBeNull();
    expect(store.activeTenant()).toBeNull();
  });

  it('setSession decodes the JWT claims into authenticated state', () => {
    // a token with payload {sub, tid, pack, tpid, roles, exp} (header.payload.sig, base64url)
    const payload = { sub: 'u1', tid: 't1', pack: 'herdbook', tpid: 'tp1', roles: ['registrar'], exp: 9999999999 };
    const token = `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`;
    store.setSession(token, { id: 'u1', displayName: 'Reg' });
    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe(token);
    expect(store.activeTenant()).toEqual({ tenantId: 't1', packId: 'herdbook' });
    expect(store.userId()).toBe('u1');
    expect(store.roles()).toEqual(['registrar']);
  });

  it('clear() returns to logged out', () => {
    const payload = { sub: 'u1', tid: 't1', pack: 'herdbook', tpid: 'tp1', roles: [], exp: 9999999999 };
    store.setSession(`x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`, { id: 'u1', displayName: 'R' });
    store.clear();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.accessToken()).toBeNull();
  });
});
```
- [ ] **Step 2: Run → fail** (`AuthStore` not defined).
- [ ] **Step 3: Implement** `auth-store.ts`:
```ts
import { Injectable, computed, signal } from '@angular/core';

export interface AuthUser { id: string; displayName?: string; }
export interface ActiveTenant { tenantId: string; packId: string; }

/** Decode a JWT payload (base64url) WITHOUT verifying — display-only; the server verifies. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    return JSON.parse(atob(b64 + pad)) as Record<string, unknown>;
  } catch { return null; }
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly _token = signal<string | null>(null);
  private readonly _user = signal<AuthUser | null>(null);
  private readonly _claims = signal<Record<string, unknown> | null>(null);

  readonly accessToken = this._token.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._token() !== null);
  readonly userId = computed(() => (this._claims()?.['sub'] as string | undefined) ?? null);
  readonly roles = computed(() => (this._claims()?.['roles'] as string[] | undefined) ?? []);
  readonly activeTenant = computed<ActiveTenant | null>(() => {
    const c = this._claims();
    if (!c) return null;
    const tenantId = c['tid'] as string | undefined;
    const packId = c['pack'] as string | undefined;
    return tenantId && packId ? { tenantId, packId } : null;
  });

  setSession(accessToken: string, user: AuthUser): void {
    this._token.set(accessToken);
    this._user.set(user);
    this._claims.set(decodeJwtPayload(accessToken));
  }
  clear(): void { this._token.set(null); this._user.set(null); this._claims.set(null); }
}
```
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `feat(web): AuthStore — in-memory access token + signal auth state (no localStorage)`.

---

## Task 3: `AuthClient` — the typed wrapper over `/auth/*`

**Files:** Create `apps/web/src/app/auth/auth-client.ts` + `apps/web/src/app/auth/auth-client.spec.ts`.

- [ ] **Step 1: Write the failing test** (use `HttpTestingController`):
```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthClient } from './auth-client';

describe('AuthClient', () => {
  let client: AuthClient; let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    client = TestBed.inject(AuthClient); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('login POSTs email+password with credentials and returns the body', async () => {
    const p = client.login('a@b.test', 'pw');
    const req = http.expectOne('/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual({ email: 'a@b.test', password: 'pw' });
    req.flush({ accessToken: 't', user: { id: 'u1' } });
    await expect(p).resolves.toEqual({ accessToken: 't', user: { id: 'u1' } });
  });

  it('refresh POSTs to /auth/refresh withCredentials', async () => {
    const p = client.refresh();
    const req = http.expectOne('/auth/refresh');
    expect(req.request.withCredentials).toBe(true);
    req.flush({ accessToken: 't2' });
    await expect(p).resolves.toEqual({ accessToken: 't2' });
  });
});
```
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `auth-client.ts` (all calls `withCredentials: true` so the refresh cookie flows):
```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface LoginResult { accessToken: string; user: { id: string; displayName?: string }; }
export interface TokenResult { accessToken: string; }

@Injectable({ providedIn: 'root' })
export class AuthClient {
  private readonly http = inject(HttpClient);
  private readonly opts = { withCredentials: true } as const;

  login(email: string, password: string): Promise<LoginResult> {
    return firstValueFrom(this.http.post<LoginResult>('/auth/login', { email, password }, this.opts));
  }
  selectTenant(tenantId: string, packId: string): Promise<TokenResult> {
    return firstValueFrom(this.http.post<TokenResult>('/auth/select-tenant', { tenantId, packId }, this.opts));
  }
  refresh(): Promise<TokenResult> {
    return firstValueFrom(this.http.post<TokenResult>('/auth/refresh', {}, this.opts));
  }
  logout(): Promise<void> {
    return firstValueFrom(this.http.post<void>('/auth/logout', {}, this.opts));
  }
}
```
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `feat(web): AuthClient — typed /auth/* wrapper (withCredentials for the refresh cookie)`.

---

## Task 4: `bearerInterceptor` — replace the dev-header shim

**Files:** Create `apps/web/src/app/auth/bearer.interceptor.ts` + spec; modify `apps/web/src/app/app.config.ts`; delete (or quarantine) `dev-auth.interceptor.ts` usage.

The interceptor: skip `/auth/*` + `/.well-known/*` (no bearer needed — and refresh must not loop); attach `Authorization: Bearer <token>` from `AuthStore` when present + `withCredentials: true`; on a 401 from an `/api` call, attempt ONE `/auth/refresh` → update the store → retry; if refresh fails, `clear()` + navigate to `/login`.

- [ ] **Step 1: Write the failing test** (`bearer.interceptor.spec.ts`) — assert: (a) an `/api/animals` request with a token in the store gets `Authorization: Bearer <token>`; (b) an `/auth/login` request gets NO Authorization header (skipped); (c) a 401 on `/api/*` triggers a single `/auth/refresh`, then the original request is retried with the new token; (d) a failed refresh clears the store. Use `HttpTestingController` + a stub `Router`. (Write the concrete assertions following the AuthClient test idiom; mock `Router.navigate` with a vitest `vi.fn()`.)
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `bearer.interceptor.ts` as a functional interceptor:
```ts
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthStore } from './auth-store';
import { AuthClient } from './auth-client';

const isAuthPath = (url: string): boolean => url.includes('/auth/') || url.includes('/.well-known/');

export const bearerInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const client = inject(AuthClient);
  const router = inject(Router);

  // Auth endpoints carry the cookie, never the bearer (avoids a refresh loop).
  if (isAuthPath(req.url)) return next(req.clone({ withCredentials: true }));

  const token = store.accessToken();
  const authed = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` }, withCredentials: true })
    : req.clone({ withCredentials: true });

  return next(authed).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && token) {
        // one refresh attempt → retry with the rotated token
        return from(client.refresh()).pipe(
          switchMap((r) => {
            // keep the user; only the token rotates (claims re-decoded in setSession upstream is fine —
            // but here we only have the token; re-set via a thin store method if user is cached)
            store.setSession(r.accessToken, store.user() ?? { id: store.userId() ?? '' });
            return next(req.clone({ setHeaders: { Authorization: `Bearer ${r.accessToken}` }, withCredentials: true }));
          }),
          catchError((refreshErr) => {
            store.clear();
            void router.navigate(['/login']);
            return throwError(() => refreshErr);
          }),
        );
      }
      return throwError(() => err);
    }),
  );
};
```
  - NOTE: `store.user()` must be readable — add a `readonly user` (already in Task 2). If `setSession` requires a non-null user, guard with the cached user.
- [ ] **Step 4:** In `app.config.ts`, swap the interceptor list: `withInterceptors([bearerInterceptor, localeInterceptor])` (remove `devAuthInterceptor`). Leave `dev-auth.interceptor.ts` on disk (unreferenced) OR delete it — prefer delete to avoid a dead dev-spoof path in a registry app; if any non-web code imports it, quarantine instead.
- [ ] **Step 5: Run → pass** (the new interceptor spec + the existing web corpus still green — the API services are unchanged; only the auth header source changed).
- [ ] **Step 6: Commit** `feat(web): bearerInterceptor replaces the dev-header shim (Bearer + refresh-on-401)`.

---

## Task 5: Login component + `authGuard` + app-init session restore

**Files:** Create `apps/web/src/app/auth/login.component.ts` + spec; create `apps/web/src/app/auth/auth.guard.ts` + spec; modify `app.routes.ts`; modify `app.config.ts` (an `provideAppInitializer` / `APP_INITIALIZER` to attempt a silent refresh on boot).

### 5a: `authGuard`
- [ ] **Step 1: Failing test** — `authGuard` returns `true` when `AuthStore.isAuthenticated()`, else returns a `UrlTree` to `/login`.
- [ ] **Step 2: fail → 3: implement** a functional `CanActivateFn`:
```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth-store';

export const authGuard: CanActivateFn = () => {
  const store = inject(AuthStore);
  const router = inject(Router);
  return store.isAuthenticated() ? true : router.createUrlTree(['/login']);
};
```
- [ ] **4: pass. 5: commit** `feat(web): authGuard — redirect the unauthenticated to /login`.

### 5b: `LoginComponent` (minimal, accessible — the prototype reskins it)
- [ ] **Step 1: Failing test** — the component renders an email + password reactive form; submit calls `AuthClient.login`, on success calls `AuthStore.setSession` + navigates to the return URL (default `/dashboard`); on a 401 shows a generic "Invalid email or password" error (never reveals which field). Use a stubbed `AuthClient` + `Router`.
- [ ] **Step 2: fail → 3: implement** `login.component.ts` — standalone, `ReactiveFormsModule`, mirror `animal-form.component.ts` styling (`.hb-label/.hb-input/.hb-alert-error/.hb-btn-primary`), with **AAA-login a11y** (login is a 3.3.8 accessible-auth / AAA-critical path):
  - A `<form>` with `<label for>` + `<input id type=email autocomplete=username>` and `<input id type=password autocomplete=current-password>` (3.3.7 redundant-entry: don't force re-entry; 3.3.8: no cognitive-test, allow paste — do NOT block paste on the password field).
  - A submit `<button>` enabled whenever the form is touched (not disabled-by-default — a disabled submit hides errors); on submit, validate.
  - An error region: `<div role="alert" class="hb-alert-error">` shown on failure with a **generic** message; `aria-live` so SR users hear it.
  - Focus management: focus the email field on init; on error, move focus to the alert (or keep it announced via role=alert).
  - A loading state on the button (`aria-busy`) during the request; disable double-submit.
- [ ] **Step 4: pass.**
- [ ] **Step 5:** Wire routes in `app.routes.ts`: add `{ path: 'login', loadComponent: () => import('./auth/login.component').then(m => m.LoginComponent) }`; wrap the existing app routes with `canActivate: [authGuard]` (either per-route or via a parent layout route — minimal: add `canActivate: [authGuard]` to the dashboard + the other top-level routes, leave `/login` open). Capture the return URL (`?returnUrl=`) in the guard's UrlTree so post-login returns to the intended page (optional-but-nice; minimal = redirect to `/dashboard`).
- [ ] **Step 6: commit** `feat(web): LoginComponent (accessible email+password) + /login route + guarded app routes`.

### 5c: app-init silent refresh (so a reload doesn't bounce to /login if the cookie is valid)
- [ ] **Step 1: Failing test** (light) — an initializer fn that calls `AuthClient.refresh()`; on success `AuthStore.setSession`, on failure swallows (stays logged out). Test the success + failure branches with a stubbed client.
- [ ] **Step 2: fail → 3: implement** + register in `app.config.ts` via `provideAppInitializer(() => { const c = inject(AuthClient); const s = inject(AuthStore); return c.refresh().then(r => s.setSession(r.accessToken, /* fetch /auth/me or decode */ { id: '' })).catch(() => {}); })`.
  - NOTE: the login response carries `user`; for the silent-refresh path, the access token's `sub` claim gives the userId (AuthStore decodes it), and a `GET /auth/me` (if the published layer serves it) can hydrate the displayName — keep minimal: decode the token, set `{ id: sub }`, skip `/auth/me` unless trivial.
- [ ] **4: pass. 5: commit** `feat(web): silent session restore on boot via the refresh cookie`.

---

## Task 6: Tenant context in the header + (minimal) logout

**Files:** Modify `apps/web/src/app/app.component.ts` (header).

- [ ] **Step 1:** Show the logged-in user + active tenant in the header (read `AuthStore.user()` + `activeTenant()`), and a **Logout** button → `AuthClient.logout()` → `AuthStore.clear()` → navigate `/login`. A multi-tenant **switcher** is **stubbed/omitted** for now (the demo registrar is single-tenant; the switcher is a D2-follow-up when a multi-homed user exists — note it).
- [ ] **Step 2:** Hide the header nav when not authenticated (the `/login` route shows a bare shell). Keep accessible (the logout button is a real `<button>` with a label).
- [ ] **Step 3: commit** `feat(web): header shows the active user/tenant + logout`.

---

## Task 7: Live-verify + gate + PR + merge

- [ ] **Step 1: Live-verify in a browser (non-negotiable).** Bring up the herdbook stack (postgres :5433 + `db:setup` seeds the registrar; API on :3200; `pnpm --filter herdbook-web run serve` on :4200). Navigate to `:4200` → redirected to `/login` → log in `registrar@vssz.test` / `registrar-dev-pw` → land on `/dashboard` → the animal registry loads with a **real token** (check DevTools: requests carry `Authorization: Bearer …`, NO `x-user-id`; the refresh cookie `substrate_rt` is httpOnly). Reload the page → stays logged in (silent refresh). Logout → back to `/login`, the registry 401s. **PASTE the proof** (the network evidence + the flow).
- [ ] **Step 2: Gate.** `pnpm run typecheck` + `pnpm run build` + `pnpm run test` (the web corpus + the new auth specs green; the api/pack corpora untouched). Lint clean (the pre-existing `mating/*` lint errors are #29's, not D2 — don't introduce new ones).
- [ ] **Step 3: Verifier wave** — `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` (+ `a11y-pro` for the login screen: WCAG 2.2 AA mandatory, AAA on the login path — 3.3.8 accessible-auth, 3.3.7 redundant-entry, focus management, the role=alert error). Address blocking.
- [ ] **Step 4: PR + merge + twin ritual.** PR (Producer/Effect; Tech design ADR-211; "D2 — herdbook real login UI; durable plumbing + minimal accessible login; org-admin + visual polish defer to the founder prototype"). Merge → drain/backfill/reconcile.

---

## Done = (D2)

A human logs into herdbook (email + password) → an EdDSA-verified token (in memory) → works the registry token-authenticated (no dev-header spoof), the refresh cookie keeping the session across reloads, logout clearing it. The dev-header shim is gone from the web app. **The tenant-management arc is functionally complete end-to-end** (A persisted multi-tenancy + B real login + C platform-admin backend + D herdbook login). The founder's UI prototype reskins `LoginComponent` + grows the org-admin "Settings → Team" surface (deferred Task 6 of the slice plan) onto this durable plumbing.

---

## Deferred (explicit, per the founder's incoming-prototype note)

- **Org self-admin "Settings → Team"** (invite/disable users, grant/revoke pack roles within a tenant) — design-dependent + needs a new herdbook backend endpoint over `core.user_tenant` + `core.pack_role_assignment`. File as a follow-up.
- **Multi-tenant switcher UI** — needs a multi-homed user to be meaningful; the plumbing (`AuthClient.selectTenant`) is built, the header switcher control is the only missing piece.
- **Visual polish** — the founder's prototype reskins `LoginComponent` + the header.

---

## Self-review (author)

- **Spec coverage:** umbrella §4 Slice D Task 5 (login + AuthClient + bearer interceptor + tenant context) → Tasks 1–6. Task 6 of the slice plan (org-admin) is explicitly DEFERRED with a filed follow-up. The "durable plumbing survives the prototype" framing matches the slice-D NOTE.
- **Security (state-of-the-art, per the founder ask):** access token **in memory only** (no localStorage — XSS-exfil hygiene); refresh via the substrate's httpOnly·Secure·SameSite=Strict cookie (browser-managed, `withCredentials`); the dev proxy makes `/auth` same-origin so the Strict cookie + the `WEB_ORIGIN` CSRF check both hold; a single refresh-retry on 401 (no loop — auth paths are skipped); generic login error (no user-enumeration); paste allowed on the password field (3.3.8). The dev-header shim is REMOVED from the web app.
- **Type consistency:** `AuthStore.setSession(token, user)` / `accessToken()` / `activeTenant()` / `isAuthenticated()`; `AuthClient.login/selectTenant/refresh/logout`; `bearerInterceptor`; `authGuard`. The login response `{ accessToken, user:{id} }` + the JWT claims (`sub/tid/pack/tpid/roles/exp`) match D1's verified live shape.
- **Risk flagged:** the login form is a FUNCTIONAL PLACEHOLDER for the founder's prototype — build it accessible + working, expect a reskin. The silent-refresh app-initializer must FAIL-OPEN (a missing/expired cookie → stay logged out, never block boot). The `setSession` user-hydration on the refresh path is thin (decode `sub`; full displayName needs `/auth/me` — keep minimal).
