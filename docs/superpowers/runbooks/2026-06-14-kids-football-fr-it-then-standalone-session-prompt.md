# Session prompt — kids-football: add fr+it locales, then a deployable standalone host

Paste the block below into a fresh Claude Code session launched from `D:/development/projects/de-braighter/`.

---

Two sequential pieces of work on the **kids-football "Club Grass" MVP** (`domains/exercir`), in order: **(A) add French + Italian locales** to the shipped Transloco i18n, then **(B) stand up a deployable standalone kids-football app**. Do A fully (merged + ritual) before starting B. The full 8-slice MVP is COMPLETE and de/en i18n already shipped (Transloco, reactive no-reload switch).

## START BY READING (in order)
1. **Memory:** `exercir-kids-football-mvp-arc.md` — the cumulative arc. Read especially the **"🌍 i18n SHIPPED 2026-06-14 (ex#266)"** section (the Transloco mechanism, the fr/it fast-follow seam, the ICU-plural caveat, the raw-status-enum-leak lesson) and the **SKIN ARC CLOSED** section (the `--cg-*` vs host `:root --color-*` collision — the reason a standalone host is wanted). Also read `[[design-system-Node-ESM-packaging]]` (published-skin consumption) and the slices-1–8 gotchas. Source of truth.
2. **Specs/plans:** `de-braighter/docs/superpowers/specs/2026-06-14-exercir-kids-football-i18n-transloco-design.md` + `…/plans/2026-06-14-exercir-kids-football-i18n-transloco.md` (the i18n design + the §6 fr/it + club.locale deferrals). The whole 8-slice MVP design: `…/specs/2026-06-11-exercir-kids-football-mvp-design.md`.
3. **The i18n code (on `origin/main`, exercir `b33de39`):** `libs/pack-kids-football-ui/src/lib/` — `kf-i18n.en.ts` + `kf-i18n.de.ts` (449-key per-locale Records), `i18n/kf-transloco-loader.ts` (the `lang==='de'?DE:EN` map to extend), `i18n/kf-transloco.providers.ts` (`availableLangs`, `provideKidsFootballI18n`), `i18n/kf-attendance-label.ts` (the status→key helper — the raw-status-leak fix), `kf-i18n.parity.spec.ts` (already loops a LOCALES map), `shell/kf-shell.component.ts` (the language `<select>`). The host wiring: `apps/pack-football-visual-editor/src/app/app.config.ts` (root `provideKidsFootballI18n()`), `app.routes.ts` (eager picker + lazy `t/:tenant/p/kids-football`), `kids-football.routes.ts`.

## PROCESS (standing flow — run it for EACH piece)
`/architecture-concierge` → `superpowers:brainstorming` (settle the open decisions → **GET FOUNDER APPROVAL on the design**) → `superpowers:writing-plans` → land spec+plan via a **workbench PR** (review floor: ≥1 `/code-review` pass) → `superpowers:subagent-driven-development` on a **FRESH manual worktree** (`cd domains/exercir && git fetch origin && git worktree add ../exercir-wt-<slug> -b feat/<slug> origin/main && cd ../exercir-wt-<slug> && GITHUB_TOKEN=ghp_… npm ci`; ALL git ops in the worktree, NEVER the main clone) → full **verifier wave** (reviewer + qa-engineer + exercir-charter-checker + **i18n-pro** for A; reviewer + qa-engineer + exercir-charter-checker + a11y-pro for B; read-only, point at the worktree, forbid git-writes + main-clone access) → **post-findings** (FULL `de-braighter/exercir#NN` form; PUSH the branch FIRST so paths resolve; run from `domains/devloop`) → fix blockers/should-fixes → merge (squash) → **twin ritual** (drain pre-merge; backfill + reviews + resolve-findings + reconcile post-merge). Create the `type/story` issue UP FRONT + `Closes #NN` in the PR body; PR carries `Producer:/Effort:/Effect:` lines (declare cycle-time + findings).

---

## PIECE A — add French + Italian locales

**Goal:** the UI offers de / en / fr / it; switching is live (no reload, already wired). German stays de-CH authoritative; **fr + it are machine-translated DRAFTS** per charter §2 D16 (lower quality bar than the hand-quality German — but glossary-consistent + placeholder-faithful).

**The headline decision (brainstorm + founder-decide): plurals.** de/en use a manual `.one/.other` two-key convention picked at the call site (`count === 1 ? '…one' : '…other'`). The i18n-pro flagged this does NOT generalize cleanly to fr (0 and 1 are both singular in French) / it. Decide:
- **Option ICU (proper):** add `@jsverse/transloco-messageformat` (`provideTranslocoMessageformat`) and convert the count-bearing keys to ICU `{n, plural, one{…} other{…}}` — correct for all four locales + future-proof. Heavier (a plugin + key-shape change for the ~handful of count keys).
- **Option 2-key (pragmatic):** keep `.one/.other` for fr/it too, accept the French-`0`-takes-other edge (rare in these UI strings — most count strings never render 0). Lightest; matches the current convention.
Recommend based on how many count keys exist + whether `0` is ever shown; lean ICU only if the edge actually surfaces.

**Mechanism (drop-in, the seam is built):**
- Create `kf-i18n.fr.ts` + `kf-i18n.it.ts` — translate ALL 449 keys (machine-draft quality; preserve every `{n}`/`{name}`/`{…}` token; keep the `.one/.other` keys; translate the `kf.player.att.*` status labels — the `attendanceLabel` helper resolves them, so a missed one re-leaks English into the fr/it UI exactly like the de raw-status bug). Football glossary in fr (Exercice/Modèle/Équipe/Entraîneur/Présence) + it (Esercizio/Modello/Squadra/Allenatore/Presenza) — pick + apply consistently.
- Extend `kf-transloco-loader.ts`'s `lang==='de'?DE:EN` to a `{ de, en, fr, it }` map.
- Add `'fr','it'` to `availableLangs` in `kf-transloco.providers.ts`.
- Add Français/Italiano options to the shell `<select>` (+ `kf.shell.lang.fr`/`.it` labels in all 4 bundles).
- The `kf-i18n.parity.spec.ts` LOCALES map → add fr + it (it already loops; this auto-gates key-parity + placeholder preservation for fr/it).
- Eager-bundle note: the providedIn:root loader statically imports all bundles → 4 catalogs eager (~120-140kB). Either accept (the standalone host in Piece B drops the pack-football baggage so the budget is moot there) OR land the deferred **lazy-load-the-non-default-bundle** optimization now (`import('./kf-i18n.<lang>.js')` in the loader — it returns an Observable). Decide in brainstorming.

**Verify:** `ci:local` + `test:db` (unchanged) + prod build (budget — fr/it add to the eager bundle; the host is at 1.04/1.1MB, watch it) + browser run-through (flip through all 4 langs live, no reload; check the run-session attendance chips show translated status in fr/it — the raw-status-leak regression class). Screenshot `de-braighter/docs/club-grass-i18n-fr-it-proof.png`. The i18n-pro wave verifier checks fr/it quality + plural correctness.

---

## PIECE B — deployable standalone kids-football app

**Goal:** a standalone, independently-buildable-and-deployable kids-football app — NOT hosted inside the shared `pack-football-visual-editor`.

**Why (the motivation — confirm in brainstorming):** (1) the shared host owns a conflicting `:root --color-*` theme — a global Club Grass skin load collides (the SKIN ARC: "kids-football accent went blue"), so the pack carries a literal `--cg-*` `:host` projection as a workaround; a standalone host that owns its theme can **adopt the published `@de-braighter/design-system-css` skin-club-grass.css at `:root`** and drop the literal projection (the SKIN ARC named this exact unlock). (2) The standalone bundle sheds the pack-football baggage → far under the 1mb budget (the i18n eager-bundle + budget-bump concerns evaporate). (3) A real product needs its own deployable artifact, not a route inside a demo editor.

**Decisions to settle (brainstorm → GET FOUNDER APPROVAL — these are real scope/ops forks):**
1. **Scope:** frontend-only standalone app (builds + serves the kids-football UI independently, points at the existing API) — OR frontend + a deployment story for the **API** (`pack-kids-football-api` :3150) too? The API is in-memory demo today; "deployable" may mean it needs a real persistence + host. Right-size it (likely: standalone frontend first; API deploy as its own follow-up).
2. **Deployment target:** static-build + a static host (Netlify/Vercel/S3/nginx)? Docker image? Just a clean `nx build` artifact + serve instructions? The founder picks the target (it drives the build config + any CI).
3. **Skin adoption:** take the SKIN ARC unlock now (load skin-club-grass.css at `:root`, drop the `--cg-*` literal `:host` projection + the parity drift-detector spec) — OR keep the literal projection for safety and just isolate the host? (Recommend taking the unlock — it's the whole point of a standalone host.)
4. **App home:** a new Nx app `apps/pack-kids-football-app` in `domains/exercir` (mounts ONLY the picker + `KIDS_FOOTBALL_ROUTES`, `provideKidsFootballI18n()` at root, the API base-URL config, theming) — vs the `/new-domain` scaffold. Likely a new Nx Angular app in exercir (reuse the existing `pack-kids-football-ui` lib wholesale).

**Likely shape:** new `apps/pack-kids-football-app` (standalone Angular 21 app) — `main.ts` + `app.config.ts` (root: `provideKidsFootballI18n()`, `provideHttpClient`, `provideRouter`, `KF_API_BASE_URL`, theme) + `app.routes.ts` (the tenant-less picker at `/` + `t/:tenant/p/kids-football` → `KIDS_FOOTBALL_ROUTES`; NO pack-football/club-mgmt/kids-sports routes) + `index.html` loading the Club Grass skin + fonts. Its own `project.json` build/serve (own port, e.g. :4300). The existing UI lib + API are reused unchanged.

**Verify:** `nx build pack-kids-football-app` (note the much smaller bundle — set a sane budget) + `ci:local` + a browser run-through against the standalone app (sign in, the coach loop, language switch, the Club Grass skin renders correctly — accent GREEN not blue, proving the skin-collision fix) + the chosen deploy artifact builds. Screenshot `de-braighter/docs/club-grass-standalone-proof.png`.

---

## ENV / GOTCHAS (carried — will bite otherwise)
- **Worktree + git:** off `origin/main`; ALL git ops in the worktree; NEVER touch the main `domains/exercir` clone (a wave agent once stashed WIP in a shared clone). Local `domains/exercir` is stale (slice-4 era) — always build off `origin/main`.
- **Gates:** `npm run ci:local > log 2>&1; echo "EXIT=$?"` — NEVER a masking pipe (a pipe returns the pipe's exit code). `@nx/angular:unit-test` REJECTS `--include`/`--run`/positional filters → run the full project (`NX_DAEMON=false npx nx test pack-kids-football-ui`). 8kB per-component-style budget is an ERROR on the PROD build (`nx build`), warning-only on `nx serve`.
- **Transloco:** single-brace interpolation `['{','}']` is configured (bundles use `{n}` not `{{ }}`); provided at the app ROOT (one instance for eager + lazy); `reRenderOnLangChange:true`; persist `cg.lang`. **The raw-status-leak class:** runtime enum tokens (attendance statuses) are NOT in the bundle, so the parity spec can't catch an untranslated one — the `attendanceLabel` helper + translated `kf.player.att.*` keys are the single source; verify in the browser run-through (it's how the de leak was caught).
- **Browser run-through:** kill orphan :3150/:4200/(:4300) ROBUSTLY — a stale :4200 survived a `netstat`-grep `taskkill` this session; use PowerShell `Get-NetTCPConnection -LocalPort <p> -State Listen | Stop-Process -Force`. Serve api (PORT=3150 in-memory, auto-seeds the 2 stub clubs + 8 drills + consent receipts) + the host; wait via a background poll on "bundle generation complete" / "listening on". Playwright MCP; `browser_evaluate` to set a `<select>` value + dispatch `change` triggers the Angular handler.
- **devloop ritual (MANDATORY):** PUSH the branch BEFORE `post-findings` (else 422 "path could not be resolved" — the commit must be in the PR's GitHub diff); run devloop CLI from `domains/devloop` (`npx tsx src/cli.ts`); `post-findings` needs the FULL `de-braighter/exercir#NN` form + a JSON written via the Write tool (PowerShell BOM breaks the parse); `gh pr edit` FAILS without read:org → edit the body via `gh api -X PATCH repos/de-braighter/exercir/pulls/NN -f body=…`.
- **Substrate:** consumed as published packages — contracts `2.3.0` (subjectSensitivity), runtime `2.x`; bump the pin only if you need an unreleased substrate change (publish from `layers/substrate` first).
- **Worktree cleanup:** `git worktree remove --force` may fail to delete the dir (Nx daemon holds `.nx/*.db`) — `git worktree prune` deregisters it; the leftover dir is cosmetic.

After each piece merges + ritual runs: update the `exercir-kids-football-mvp-arc` memory (keep the MEMORY.md index entry to ONE line) and report to the founder.
