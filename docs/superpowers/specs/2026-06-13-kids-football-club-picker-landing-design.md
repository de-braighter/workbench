# Kids-football club-picker landing (design)

> **Status:** approved (brainstorming) 2026-06-13. A small front-door fix: replace the stale default route (`/` → the old pack-football drill-board editor) with a tenant-less **club-picker landing** for the Club Grass kids-football MVP.
> **Repo:** `domains/exercir`. **Substrate:** no change (pure UI + client-side storage; no API, no schema, no kernel touch).
> **Related:** `2026-06-11-exercir-kids-football-mvp-design.md` (the MVP this fronts). The kids-football app is hosted by the shared `pack-football-visual-editor` Angular app on `:4200`; its routes are mounted at `t/:tenant/p/kids-football`.

## 1. Goal

`http://localhost:4200/` currently redirects to `/p/football/editor` — the *old* pack-football drill-board editor, stale now that kids-football (Club Grass) is the active MVP. Replace that default with a **tenant-less club-picker landing**: a visitor with no tenant in the URL picks a club, then lands on that club's existing sign-in (profile picker). The picker also offers "Set up a new club" (the onboarding wizard), and **remembers clubs the visitor creates** so they stay reachable from the front door.

## 2. Decisions (2026-06-13 brainstorming)

1. **Default route → club-picker landing** (chosen over a default-tenant redirect or a neutral multi-pack launcher). `/` redirects to a new tenant-less `/kids-football` route that renders the picker.
2. **Club list = static demo clubs ∪ remembered created clubs** (chosen over static-only). Demo clubs derive from `DEMO_USERS` fixtures (FC Sonnenberg + FC Stadtpark); clubs created via the wizard are cached in `localStorage` and merged in, deduped by `tenantId`.
3. **Picker lives in `pack-kids-football-ui`**, mounted as a sibling host route (chosen over putting kids-football UI in the shared host app) — keeps all kids-football UI behind the `scope:pack-kids-football` boundary; the host only wires a route + the `/` redirect.
4. **No new API / schema / kernel.** "List all tenants" is deliberately absent (it would leak every club to every visitor); "my created clubs" can therefore only be remembered client-side.
5. **Demo-mode front door** (charter §2 D7). The global club list is a demo affordance; a code comment pins the production seam (real product = per-club deep links / marketing entry, not a global picker).

## 3. Why a sibling route, not a child

`KIDS_FOOTBALL_ROUTES` are mounted under `t/:tenant/p/kids-football`, so every path in that array inherits a `:tenant` segment. A front door whose whole purpose is "you have no tenant yet" cannot be expressed inside that subtree — it must be a peer route. This is the routing shape of multi-tenancy: tenant-less surfaces (picker / login-chooser) vs. tenant-scoped app surfaces. The picker therefore lives in the host app's `app.routes.ts` as a top-level `/kids-football` route, with its component exported from the lib (the established pattern — `SignInPageComponent` / `OnboardingWizardComponent` are already exported "for direct host-app use").

## 4. Components & changes

### 4.1 `KfKnownClubsService` (new — `libs/pack-kids-football-ui/src/lib/data/kf-known-clubs.service.ts`)

Client-side store of clubs the visitor has created.

- Backed by `localStorage`, key `cg.knownClubs`. Shape `KnownClub = { tenantId: string; clubName: string }`.
- `list(): KnownClub[]` — read + zod-validate; missing/corrupt JSON → `[]` (never throws).
- `remember(club: KnownClub): void` — upsert, dedup by `tenantId`; **skip the two demo tenants** (they come from fixtures, not storage).
- All `localStorage` access wrapped in try/catch — private-mode / disabled-storage / quota-exceeded degrade to empty rather than crashing the landing.

### 4.2 `DEMO_CLUBS` derivation (edit — `libs/pack-kids-football-ui/src/lib/data/demo-fixtures.ts`)

`export const DEMO_CLUBS` derived from the distinct `DEMO_USERS` tenantIds via `clubNameForTenant`, plus a per-club profile count — single source of truth, no hand-maintained second list. Shape `{ tenantId, clubName, profileCount }`.

### 4.3 `ClubPickerPageComponent` (new — `libs/pack-kids-football-ui/src/lib/landing/club-picker-page.component.ts`)

The tenant-less landing screen.

- Club Grass dark-ink visual language, reusing `club-grass.css` + the sign-in page's `:host` style idiom for parity (literal `--cg-*` values per the shared-host theme-collision note).
- Club list = `DEMO_CLUBS` ∪ `knownClubs.list()`, deduped by `tenantId`. Each row: club name + subtitle (demo → "N profiles"; created → "you created"). Click → `router.navigate(['/t', tenantId, 'p', 'kids-football', 'sign-in'])`.
- "+ Set up a new club" → `router.navigate(['/t', 'demo', 'p', 'kids-football', 'setup'])` (reuses the wizard's existing throwaway-`'demo'`-tenant pattern; the wizard mints its own tenant on submit).
- a11y (matches the sign-in page's bar): `<h1>` heading, `role="region"`, a real list of `<button>` elements, focus-visible ring, ≥44px targets.

### 4.4 Onboarding-wizard hook (edit — `libs/pack-kids-football-ui/src/lib/onboarding/onboarding-wizard.component.ts`, `submit()`)

After `createClub` succeeds (`const res = await this.client.createClub(req)`), call `knownClubs.remember({ tenantId: res.tenantId, clubName: res.clubName })` **before** `signIn`/`navigate`. One injected service, one call. Not reached on failure (the existing early-return on error path is unchanged).

### 4.5 Host route wiring (edit — `apps/pack-football-visual-editor/src/app/app.routes.ts`)

- Change `{ path: '', pathMatch: 'full', redirectTo: '/p/football/editor' }` → `redirectTo: '/kids-football'`.
- Add `{ path: 'kids-football', loadComponent: () => import(...).then(m => m.ClubPickerPageComponent) }`.
- Export `ClubPickerPageComponent` from the lib's `index.ts`.
- `/p/football/editor` stays reachable by direct URL (not deleted).

## 5. Data flow

```
/  →(redirect)→  /kids-football
                 picker = DEMO_CLUBS ∪ localStorage(cg.knownClubs)
   ├─ click club ─→ /t/:tenant/p/kids-football/sign-in  (existing profile picker)
   │                   └─ pick profile ─→ app (drills | admin per role)
   └─ "Set up a new club" ─→ /t/demo/p/kids-football/setup  (existing wizard)
                                └─ on success: knownClubs.remember(res) → localStorage
                                   (next visit to /kids-football shows the new club)
```

## 6. Testing

- **`KfKnownClubsService`**: empty / corrupt-JSON / `localStorage`-throws → `list()` returns `[]`; `remember` upserts, dedups by `tenantId`, skips demo tenants.
- **`ClubPickerPageComponent`**: renders demo clubs; merges a `localStorage`-seeded club; dedups a created-club that collides with a demo tenant; club click navigates to the right `sign-in` target; "set up" navigates to the `setup` target; a11y (heading present, club rows are buttons, focus management).
- **Onboarding**: `remember()` called with `res.tenantId`/`res.clubName` on success; **not** called on a failed create.
- **Host routing**: `''` redirects to `/kids-football`; the route resolves the picker component.

## 7. Scope / YAGNI

- No new API, no Prisma schema, no kernel concept. Pure UI + client storage.
- No "edit / forget club" management UI — the list only accumulates; clearing `localStorage` resets it (noted in code).
- No i18n-new-bundle beyond the existing `kf-i18n` pattern for the few new strings (picker title, "you created", "N profiles", "Set up a new club" — the last already exists).
- Production seam pinned in a code comment: a real deployment fronts clubs via per-club deep links / a marketing site, not a global picker.

## 8. Risks / notes

- **Shared-host theme collision** (battle-tested in the skin arc): the picker must carry literal `--cg-*` values on `:host`, like the sign-in page — a `:root`-scoped skin is inert under emulated encapsulation and the host carries a conflicting `--color-*` theme.
- **`localStorage` is per-origin, not per-tenant** — created clubs from *any* club show in the picker on this browser. Acceptable for a demo front door; called out so it isn't mistaken for a tenant leak (no server data crosses tenants).
