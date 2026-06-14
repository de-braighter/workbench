# Exercir kids-football — i18n (Transloco, de + en) design

> **Status:** approved (brainstorming) 2026-06-14. Internationalize the Club Grass kids-football UI with a **reactive** i18n library (Transloco) so the language switches at **runtime with no page reload**. Ship **German (de-CH, hand-quality) + English (fallback)** now; **fr/it are a trivial fast-follow** (two more bundle files). The full 8-slice MVP shipped 2026-06-14 (exercir#264); this is the first polish item.
> **Repo:** `domains/exercir` (single-repo; UI-only — `libs/pack-kids-football-ui` + the host app providers). No new substrate, no schema, no API change.
> **Related:** `2026-06-11-exercir-kids-football-mvp-design.md` §7 (i18n via the ADR-012 convention; de likely primary, confirmed here) · the charter §2 D16 four-locale parity (de-CH authoritative; fr/it/en machine-translated drafts) — this pass delivers de+en and leaves fr/it as a content fast-follow the mechanism supports.

## 1. Goal

Make every user-facing string in the Club Grass UI translatable and let a coach/admin switch the UI language **live** (German ↔ English) from a switcher in the shell, with the choice remembered across visits — **no reload**. German is the primary club locale (de-CH); English is the fallback for any missing key and the dev default on non-German browsers.

## 2. Current state (what we're migrating from)

`libs/pack-kids-football-ui/src/lib/kf-i18n.ts` is a **home-grown flat English `Record`** — `KF_MESSAGES: Record<string,string>` of **446 dotted keys** (`'kf.shell.nav.team': 'Team'`) — plus four plain-`.replace()` resolvers: `kfMsg(key)`, `kfMsgN(key,n)` (single `{n}`), `kfMsgNamed(key,name)`, `kfMsgSubst(key, subs)`. Used across **~26 components**, typically as `protected readonly msg = { x: kfMsg('kf.x') }` (computed once at construction) rendered as `{{ msg.x }}`. Plurals use a **manual `.one`/`.other` two-key convention** (e.g. `kf.picker.profileCount.one/.other`), not ICU. There is **no locale-awareness** (no active-locale concept) and **no `locale`/`language` field** on the club or session. The compute-once `msg` pattern is exactly why live switching needs a reactive library, not a bundle swap under `kfMsg`.

## 3. Decisions (2026-06-14 brainstorming)

1. **Library: Transloco (`@jsverse/transloco`).** Reactive runtime switching (`reRenderOnLangChange: true` + `setActiveLang()` re-renders the `transloco` pipe with **no reload** — the founder's hard requirement). Signal-based, standalone-first (`provideTransloco`), lazy-loading, with built-in `provideTranslocoPersistLang` (localStorage) + browser-detect (`getBrowserLang`). The modern, actively-maintained successor to ngx-translate (the `@ngneat` scope is deprecated → `@jsverse`). **Rejected:** the home-grown reload mechanism (not reactive); ngx-translate (fine but older); `@angular/localize` (compile-time, no runtime switch).
2. **Scope: de + en now; fr/it fast-follow.** German hand-quality (the real user need, de-CH authoritative per charter D16); English the fallback bundle + non-German-browser default. fr/it are two more `Record` files + two `availableLangs` entries later — zero component change. (Not full four-locale parity in v1 — that's a content task the mechanism enables incrementally.)
3. **Bundles via a TS loader (no JSON assets).** A custom `TranslocoLoader` returns the existing **flat dotted-key Records** (`KF_MESSAGES_EN`, new `KF_MESSAGES_DE`) from TS — keeps bundles **typed + colocated in the lib**, avoids HTTP/asset-serving config for a buildable Angular lib. Transloco resolves flat dotted keys directly. `fallbackLang: 'en'` → a missing DE key renders English, never a raw key.
4. **Locale selection: browser-detect + shell switcher + localStorage persistence — via Transloco built-ins, no new field.** Default = persisted (`provideTranslocoPersistLang`, key `cg.lang`) ?? browser (`getBrowserLang()`: `de*`→`de`, else `en`). A language `<select>` in the shell top bar (next to the team switcher) calls `setActiveLang(lang)`. No `club.locale`/`session.locale` field this pass. **Production-correct seam (deferred):** a `club.locale` admin setting.
5. **Component migration to the `transloco` pipe.** Reactive switching requires the pipe in templates: `{{ 'kf.x' | transloco }}`, interpolation `{{ 'kf.x' | transloco: { n: count } }}`, blocks via `*transloco="let t; read: '...'"` where it reads cleaner. Each component imports the Transloco pipe/module and drops its `msg` object + `kfMsg` import. The manual `.one/.other` plural pick stays in-template (de/en both 2-form → no ICU plugin). The home-grown `kfMsg*` resolvers are retired once no component imports them (the EN/DE Records live on as the loader's source).
6. **`reRenderOnLangChange: true`** (not the deprecated `listenToLangChange`). Required so already-rendered templates update on `setActiveLang`.

## 4. Layer plan

### 4.1 Dependency + provider wiring
- Add `@jsverse/transloco` (latest v8.x). **GATE — Angular 21.2 peer-dep (real risk):** verify `npm install` resolves it against Angular 21.2 before the migration. If the peer range tops out below 21 → try the latest/`next` tag; if still blocked, fall back to `ngx-translate` (same reactive pipe pattern, re-scope the loader) or, last resort, a lightweight signal-based reactive resolver. The implementer confirms at Task 1 and reports before proceeding.
- `provideTransloco({ config: { availableLangs: ['de','en'], defaultLang: 'en', fallbackLang: 'en', reRenderOnLangChange: true, prodMode: <env> }, loader: KfTranslocoLoader })` + `provideTranslocoPersistLang({ storageKey: 'cg.lang' })`. Placed in the **host app** providers where `KIDS_FOOTBALL_ROUTES` mount (the kids-football UI is hosted by `pack-football-visual-editor`), OR scoped to the kids-football routes if Transloco scoping is cleaner — the plan picks the narrowest placement that doesn't leak into the pack-football surfaces.
- `KfTranslocoLoader implements TranslocoLoader`: `getTranslation(lang)` returns `lang === 'de' ? KF_MESSAGES_DE : KF_MESSAGES_EN` (sync/`of(...)`). Default-lang resolution (browser): a small factory sets `defaultLang` from `getBrowserLang()` constrained to `['de','en']` (fallback `en`) when no persisted value.

### 4.2 Bundles (`libs/pack-kids-football-ui/src/lib`)
- `kf-i18n.en.ts` — the existing 446 keys as `KF_MESSAGES_EN` (verbatim move from `kf-i18n.ts`).
- `kf-i18n.de.ts` — `KF_MESSAGES_DE`, German (de-CH) for **all 446 keys**, hand-quality (natural German UI; `ss` not `ß`; keep `{n}`/`{name}`/`{...}` placeholders + the `.one/.other` keys 1:1).
- `kf-i18n.ts` — retained as the loader-facing barrel (exports the two Records + the loader); the `kfMsg*` resolvers removed once unused (or kept only if a non-template caller remains — e.g. `kf-error.ts` maps an HttpError to a key; that becomes `transloco.translate(key)` via the service).

### 4.3 Component migration (~26 components + specs)
- Per component: import the Transloco pipe (`TranslocoModule` or `TranslocoPipe` in `imports`), replace `{{ msg.x }}` → `{{ 'kf.x' | transloco }}` (params for interpolated strings), remove the `msg` object + `kfMsg` import. For aria-labels/attributes computed in TS, use `transloco.translate('kf.x', params)` (the service) where a pipe can't reach, or `selectTranslate` for reactive TS values.
- `kf-error.ts` (maps `HttpErrorResponse` → an i18n key): switch from `kfMsg(key)` to injecting `TranslocoService` + `translate(key, params)` (it runs outside a template).
- The plural `.one/.other` call-sites: keep the in-template/in-TS pick (`count === 1 ? '…one' : '…other'`) — the pipe resolves whichever key.
- **Specs:** components asserting rendered strings get `TranslocoTestingModule.forRoot({ langs: { en: KF_MESSAGES_EN }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })` (or the lib's test harness) so they keep asserting English. This is the broad-but-mechanical part.

### 4.4 Switcher (`shell/kf-shell.component.ts`)
- A language `<select>` in the top bar (de/en, `aria-label`, `data-testid="kf-lang-select"`) bound to `transloco.getActiveLang()`, `(change)` → `transloco.setActiveLang(value)`. Persistence is automatic via `provideTranslocoPersistLang`. Live re-render via `reRenderOnLangChange`. No reload, no `KfLocaleService`.

## 5. Testing

- **Loader/config:** `KfTranslocoLoader.getTranslation('de')`/`('en')` returns the right Record; browser-default resolver maps `de-CH`→`de`, `fr-FR`→`en`, none→`en`.
- **Switcher:** `setActiveLang('de')` flips `getActiveLang()`; persistence writes `cg.lang`; a shell spec asserts the select renders both langs + change calls `setActiveLang`.
- **Parity spec:** `Object.keys(KF_MESSAGES_DE).sort()` deep-equals `Object.keys(KF_MESSAGES_EN).sort()` (no missing/extra keys — the fr/it gate later). Also assert every value retains its `{...}` placeholders (a German string that dropped `{n}` is a bug).
- **Reactive proof (component spec):** render a migrated component under `TranslocoTestingModule`, `setActiveLang('de')`, assert the DOM text changed **without re-creating the component** (the no-reload guarantee).
- **Migrated component specs:** keep asserting English via the EN test bundle.
- **Gate:** `npm run ci:local` (no masking pipe) + `npm run test:db` (unchanged — UI-only, no DB shape; run it green) + the **prod build** (`nx build pack-football-visual-editor` — the pipe migration shouldn't change the 8kB budgets, but confirm). Full **browser run-through**: sign in → flip the shell language to German → the whole UI (nav, roster, modals, run-session) renders in German **without a reload** → flip back → reload the page → German persists (localStorage). Screenshot `de-braighter/docs/club-grass-i18n-de-proof.png`.
- **Process:** create the `type/story` issue + `Closes #NN`; PR carries `Producer:/Effort:/Effect:` lines.

## 6. Scope / YAGNI

- **In:** the Transloco dependency + provider/loader/persist/browser-detect wiring; the `kf-i18n.{en,de}.ts` bundle split + the German translation of all 446 keys; the ~26-component pipe migration + spec updates; the shell language switcher; the key-parity + reactive-switch specs.
- **Out (deferred):** **fr/it** translations (two Record files + two `availableLangs` entries — a follow-up the mechanism already supports); the `club.locale` field + admin setting (production-correct locale selection); ICU/`provideTranslocoMessageformat` (the `.one/.other` convention suffices for de/en); JSON-asset HTTP loader; translating the design-handoff/proto content.

## 7. Risks / notes

- **Angular 21.2 peer-dep (the central risk):** Transloco v8 must accept Angular 21.2. Verified at Task 1 before the migration; fallback to ngx-translate or a signal-based resolver if blocked. Don't migrate 26 components until the library installs clean.
- **Migration breadth:** ~26 components + their specs change. Mechanical but broad — do it per-component (subagent-driven), keeping each commit green. The German translation (446 strings) is the other large chunk — hand-quality, placeholders preserved.
- **Test-locale default:** the test env must resolve to `en` (jsdom `navigator.language` is `en-US` → `en`) so existing string assertions stay valid; pin the test config's `defaultLang: 'en'` to be safe.
- **Scope placement:** wire Transloco so it does NOT leak translation behavior into the sibling `pack-football` surfaces hosted by the same app — scope to the kids-football routes/lib if a global provider would collide.
- **`kf-error.ts` + any TS-side string building** can't use the pipe — use `TranslocoService.translate()`; ensure it reads the active lang reactively where surfaced.
- **CSS budget unaffected** (no style change), but run the prod build anyway.
