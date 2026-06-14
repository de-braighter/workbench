# Exercir kids-football — i18n French + Italian locales design

> **Status:** approved (brainstorming) 2026-06-14. Add **French (fr)** and **Italian (it)** to the shipped Transloco i18n in the Club Grass kids-football UI, so the shell language switcher offers **de / en / fr / it** with the same reactive no-reload live switch. German (de-CH) stays the quality-authoritative locale; **fr + it are machine-translated DRAFTS** (charter §2 D16), shipped live in the switcher now, with human-native review deferred as a follow-up.
> **Repo:** `domains/exercir` (single-repo; UI-only — `libs/pack-kids-football-ui` + a host build-budget bump). No new substrate, no schema, no API change.
> **Builds on:** `2026-06-14-exercir-kids-football-i18n-transloco-design.md` (the de+en Transloco landing, exercir#266) — which left fr/it as an explicit "trivial fast-follow (two more bundle files)". This spec is that fast-follow.
> **Charter:** §2 D16 four-locale parity — de-CH authoritative; fr/it/en machine-translated drafts. The de+en pass delivered de (hand-quality) + en (fallback); this pass adds the fr+it drafts, completing the four-locale set the charter calls for.

## 1. Goal

Make the Club Grass UI offer **four languages** (de / en / fr / it) from the existing shell `<select>`, switching live with **no page reload** (the mechanism already shipped). A coach in French- or Italian-speaking Switzerland gets a usable UI in their language; German remains the authoritative club locale and English the fallback for any (there should be none) missing key.

## 2. Current state (what we're extending)

The de+en Transloco i18n shipped in exercir#266 (`b33de39`) as a deliberate **drop-in seam**:

- **Bundles:** `libs/pack-kids-football-ui/src/lib/kf-i18n.en.ts` (`KF_MESSAGES_EN`) + `kf-i18n.de.ts` (`KF_MESSAGES_DE`) — flat dotted-key `Record<string,string>`, **456 keys** each, at parity.
- **Loader:** `i18n/kf-transloco-loader.ts` — `getTranslation(lang)` returns `of(lang === 'de' ? KF_MESSAGES_DE : KF_MESSAGES_EN)`. `@Injectable({providedIn:'root'})`, **statically imports both catalogs** (so both are eager in the initial bundle).
- **Providers:** `i18n/kf-transloco.providers.ts` — `provideKidsFootballI18n()` with `availableLangs: ['de','en']`, `defaultLang: kfDefaultLang()` (browser-detect: `de*`→de else en), `fallbackLang: 'en'` + `missingHandler.useFallbackTranslation`, `reRenderOnLangChange: true`, **`interpolation: ['{','}']`** (the bundles author placeholders as single-brace `{n}`/`{name}`), and `provideTranslocoPersistLang({ storageKey: 'cg.lang' })`.
- **Switcher:** `shell/kf-shell.component.ts` — a `<select data-testid="kf-lang-select">` with two `<option>`s (`kf.shell.lang.de` / `.en`), `(change)` → `transloco.setActiveLang(value)`.
- **Parity gate:** `kf-i18n.parity.spec.ts` — loops a `LOCALES` map (currently `{ de }`) and asserts, per locale: (a) exact EN key-set, (b) identical `{placeholder}` token-set per key, (c) "differs from EN" (< 15% of values identical — guards against a leftover English copy).
- **Status-label helper:** `i18n/kf-attendance-label.ts` — `attendanceLabel(status, t)` maps a raw `MemberAttendance` enum token onto `kf.player.att.<status>`. This exists because the de pass had a real bug: raw enum tokens (`present`/`sick`/…) are **runtime values, not bundle content**, so they leak into the UI as visible English text and the parity spec cannot catch them. The `kf.player.att.*` keys must be translated in every locale.
- **Host wiring:** `provideKidsFootballI18n()` is provided at the app **root** (`apps/pack-football-visual-editor/src/app/app.config.ts`) so one `TranslocoService` covers both the eager tenant-less club-picker and the lazy `t/:tenant/p/kids-football` subtree. The host `initial` build budget was raised to **1.1 MB** to absorb the two eager catalogs (it was at ~99.5% before i18n).

## 3. Decisions (2026-06-14 brainstorming, founder-approved)

1. **Plurals: keep the 2-key `.one/.other` pick — NO ICU.** There is exactly **one** plural pair in the whole app (`kf.picker.profileCount.one/.other`). The existing `count === 1 ? '…one' : '…other'` pick renders fr/it correctly for every value **except** French `0` (it yields "0 profils" via `.other`; the strict French form is the singular "0 profil"). Italian uses plural for 0, so "0 profili" is already correct. This single, cosmetically-debatable edge on a club-picker count does not justify adding `@jsverse/transloco-messageformat` (a dependency + transpiler bundle weight + ICU rewrite). **ICU stays a clean later upgrade** if many plural/select messages ever arrive. *Known limitation, documented:* French "0 profils".
2. **Bundles: keep ALL FOUR catalogs eager; bump the host budget — NO lazy-load.** The loader keeps its synchronous `providedIn:'root'` shape with a four-way map; all four Records land in the eager initial bundle (~120–140 kB total). The host `initial` budget is raised to clear the measured four-catalog size with headroom (exact value set from the real build — see §5). The deferred lazy-load-non-default-bundle optimization is **NOT** taken here. Rationale: it is the simplest change, and the bundle-weight concern is being retired at its root by Piece B (the standalone kids-football app sheds the entire pack-football bundle), so investing in a lazy-loader on the shared host now would be throwaway complexity.
3. **Posture: ship fr/it as machine-translated DRAFTS live in the switcher now (charter §2 D16).** de-CH + en remain quality-authoritative; fr/it are added to the switcher immediately, token-faithful with the `kf.player.att.*` status labels and the non-deficit developmental tone translated. The bundle file headers mark them as machine-translated drafts. Human-native review is a deferred follow-up (it does not block shipping the drafts).

## 4. Layer plan (the drop-in seam)

All changes are in `libs/pack-kids-football-ui/src/lib` plus one host build-budget bump. No component logic changes except two `<option>`s in the shell.

### 4.1 Bundles
- **`kf-i18n.fr.ts`** — `export const KF_MESSAGES_FR: Readonly<Record<string,string>> = { … }`, all 456 keys translated to natural French (Swiss-French register where it differs; standard French is fine for drafts). File-header banner: *machine-translated draft; de-CH + en authoritative (charter §2 D16)*.
- **`kf-i18n.it.ts`** — `KF_MESSAGES_IT`, all 456 keys, natural Italian, same header banner.
- **Token fidelity (hard rule):** every `{n}`/`{name}`/`{h}`/`{color}`/`{label}`/`{x}`/… placeholder is preserved verbatim per key (the parity spec gates this).
- **Status labels (the leak class):** `kf.player.att.present|absent|sick|holiday|school` MUST be translated (fr: *Présent·e / Absent·e / Malade / Vacances / École*; it: *Presente / Assente / Malato·a / Vacanza / Scuola*) — a miss re-leaks English exactly like the de raw-status bug, and the parity spec cannot catch it because the leak is the runtime enum value, not the bundle content. **Verify in-browser** (run-session + roster chips), not only via specs.
- **Developmental tone (non-deficit):** mirror the German tone for `kf.player.dev.*` — e.g. `kf.player.dev.notYet` → fr "– Pas encore" / it "– Non ancora"; the practice caption ("a record of practice while present — not a skill rating") → a faithful, non-deficit fr/it rendering.
- **Glossary (consistency across all 456 keys):**

  | Concept | de (authoritative) | fr | it |
  |---|---|---|---|
  | Drill | Übung | Exercice | Esercizio |
  | Template | Vorlage | Modèle | Modello |
  | Team | Mannschaft | Équipe | Squadra |
  | Coach | Trainer | Entraîneur | Allenatore |
  | Attendance | Anwesenheit | Présence | Presenza |
  | Match | Spiel | Match | Partita |
  | Slot (training time) | Trainingszeit | Créneau | Fascia oraria |
  | Player | Spieler | Joueur·euse | Giocatore·trice |
  | Session (run) | Training | Séance | Sessione |
  | Club | Verein | Club | Club |

### 4.2 Loader (`i18n/kf-transloco-loader.ts`)
- Replace the `lang === 'de' ? DE : EN` ternary with a static lookup map `{ de: KF_MESSAGES_DE, en: KF_MESSAGES_EN, fr: KF_MESSAGES_FR, it: KF_MESSAGES_IT }`, returning `of(map[lang] ?? KF_MESSAGES_EN)`. Still synchronous, still `providedIn:'root'`, all four catalogs statically imported (eager — per Decision 2).

### 4.3 Providers (`i18n/kf-transloco.providers.ts`)
- `availableLangs: ['de','en','fr','it']`. Everything else unchanged (`defaultLang`/`fallbackLang`/`interpolation`/persist-lang all carry over). `kfDefaultLang()` keeps returning only `de`/`en` (browser-detect default) — fr/it are reachable via the switcher + persistence, not auto-defaulted (a forward seam if the founder later wants `fr-*`/`it-*` browser-default; out of scope here).

### 4.4 Switcher (`shell/kf-shell.component.ts`)
- Add two `<option>`s: `<option value="fr">{{ 'kf.shell.lang.fr' | transloco }}</option>` and `<option value="it">{{ 'kf.shell.lang.it' | transloco }}</option>`.
- Add `kf.shell.lang.fr` (= "Français") + `kf.shell.lang.it` (= "Italiano") to **all four** bundles (en/de/fr/it). Native autonyms ("Français"/"Italiano") in every bundle — language names are conventionally shown in their own language.

### 4.5 Parity spec (`kf-i18n.parity.spec.ts`)
- Add `fr: KF_MESSAGES_FR` and `it: KF_MESSAGES_IT` to the `LOCALES` map. The three existing per-locale assertions auto-gate fr+it (key-set, placeholder-tokens, < 15% identical).

### 4.6 Host build budget (`apps/pack-football-visual-editor/project.json`)
- Raise the `initial` budget `maximumError` from 1.1 MB to whatever clears the measured four-catalog build with comfortable headroom (likely ~1.2 MB; exact value from §5 step). Add/extend the existing budget-rationale comment to note the four eager catalogs and that Piece B (standalone app) retires this pressure.

## 5. Testing & verification

- **Parity spec** (`kf-i18n.parity.spec.ts`): fr + it pass key-set, placeholder-token-set, and < 15%-identical gates.
- **Shell spec** (`shell/kf-shell.component.spec.ts`): the lang `<select>` renders **four** options; `(change)` to `fr`/`it` calls `setActiveLang`.
- **`npm run ci:local`** (no masking pipe: `> log 2>&1; echo "EXIT=$?"`, then READ the log) — build + lint + test green across projects.
- **`npm run test:db`** — unchanged (UI-only, no DB shape); confirm green.
- **Prod build** `npx nx build pack-football-visual-editor` — passes with the bumped budget; no per-component-style 8 kB ERROR (the shell gains only two `<option>`s; negligible). Record the actual `initial` size to set the budget value.
- **Browser run-through** (Playwright MCP, worktree api :3150 in-memory + host :4200): sign in → flip the shell language through **all four** (de → en → fr → it) live with **no reload** → confirm nav/roster/modals render translated → **run a session and confirm the fr + it attendance-status chips show translated labels** (the leak class) → reload → the chosen language persists (localStorage `cg.lang`). Screenshot the French (or Italian) UI to `de-braighter/docs/club-grass-i18n-fr-it-proof.png`.
- **i18n-pro wave check:** fr/it translation quality, placeholder fidelity, the plural pick (French-0 limitation acknowledged), and the status-label coverage.

## 6. Scope / YAGNI

- **In:** `kf-i18n.fr.ts` + `kf-i18n.it.ts` (456 keys each, drafts); the loader four-way map; `availableLangs` fr+it; the shell two `<option>`s + `kf.shell.lang.fr/.it` in all four bundles; the parity `LOCALES` fr+it entries; the host budget bump.
- **Out (deferred):** ICU / `@jsverse/transloco-messageformat` (the 2-key pick suffices; French-0 documented); lazy-load-non-default-bundle (Decision 2 — Piece B retires the pressure); fr/it browser-default (`kfDefaultLang` stays de/en); the `club.locale` admin field (production locale-selection seam); human-native review of the fr/it drafts (a follow-up, non-blocking per D16).

## 7. Risks / notes

- **The status-label leak class is the top risk** — it is invisible to the parity spec (runtime enum tokens, not bundle content). The de pass shipped this bug and i18n-pro caught it in the wave. Mitigation: translate `kf.player.att.*` in fr+it AND verify the run-session/roster chips in-browser for both.
- **Translation breadth:** 456 keys × 2 locales = 912 strings to translate, token-faithful and glossary-consistent. The orchestrator may dispatch dedicated translation subagents (one per locale) — quality matters (these go live in the switcher), even as drafts.
- **Budget bump on the shared host** grows the eager bundle for every visitor (incl. non-switchers and the sibling pack-football surfaces hosted by the same app). Accepted per Decision 2; root-caused by Piece B.
- **`kf.player.dev.*` tone** is an ethics surface (developmental view of minors) — the non-deficit framing (ADR-188 C2/C4) must survive translation; a deficit-toned fr/it rendering would be a charter regression, not just a copy nit.
- **No new dependency, no schema, no API, no kernel/substrate touch** — this is pure pack-UI content + config, the lowest-risk change class.
</content>
</invoke>
