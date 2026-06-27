# Fresh-session prompt — studio-ui catalog persistence (staged: localStorage now, substrate-ready)

> Copy everything in the fenced block below into a **new** Claude Code session launched from
> `D:/development/projects/de-braighter/` (the cluster root). It is self-contained.

---

```
GOAL
Make the studio-ui catalog (the "Katalog": Systems / Subjects / Phases / Capabilities /
Traits / Interventions / Resources / Actions) PERSIST, so a user's authored/edited catalog
survives a page reload instead of resetting to the demo seed. Studio-ui only has product
value once authored models survive reload.

APPROACH (founder-decided — do not relitigate)
- STAGED persistence: implement browser localStorage NOW, behind an ASYNC port so a future
  SubstrateClient/HTTP adapter drops in later with zero surface changes. This mirrors the
  pattern ALREADY SHIPPED in the sibling board-editor app (see "Mirror this" below).
- DESIGN-FIRST: brainstorm + write a short design note resolving the open decisions, THEN
  implement with TDD. Do not skip straight to code.
- ZERO kernel/substrate change. This is Ring 4/5 product code (an app-local persistence
  adapter). It authors no kernel concept (ADR-176, packs-compose-not-author).

REPO & WORKING DIR
- Cluster root: D:/development/projects/de-braighter/ (launch Claude Code here).
- Target repo: domains/studio (git remote de-braighter/studio). PR-gated; branch -> PR ->
  founder-gated merge. NEVER commit to main directly.
- App: domains/studio/apps/studio-ui (standalone Angular 21, @angular/build esbuild,
  signal-native).

CURRENT STATE (verified 2026-06-27)
- studio-ui catalog is IN-MEMORY ONLY and re-seeds on every reload.
- Store: `InMemoryCatalogStore` (SYNCHRONOUS read/mutate API: snapshot/list/get/has + CRUD,
  immutable updates) in apps/studio-ui/src/app/metamodel/catalog-store.ts.
- Catalog shape + helpers: apps/studio-ui/src/app/metamodel/catalog.ts
  (`Catalog`, `cloneCatalog`, `emptyCatalog`, `findItem`, `libraryOf`). It is EIGHT item
  arrays — NO relationship graph (relationships are DERIVED views in
  metamodel/derived-relationships.ts per ADR-176 "store generators, derive graphs").
- Seed: apps/studio-ui/src/app/metamodel/seed.ts `seedCatalog()` (the handoff demo catalog).
- Wiring: the store is a ROOT SINGLETON via an InjectionToken
  `CATALOG_BROWSER_STORE` in apps/studio-ui/src/app/catalog-browser/catalog-store.token.ts
  (`providedIn: 'root'`, `factory: () => new InMemoryCatalogStore(seedCatalog())`). Every
  surface (catalog-browser + item editors) injects this token and reads/mutates the singleton;
  a version signal re-projects views on mutation. So edits already survive NAVIGATION within a
  session — they are only lost on RELOAD.

MIRROR THIS (the shipped board-editor precedent — read it first, copy its conventions)
- libs/board-editor/src/lib/catalog-store.ts       — `CatalogStorePort` interface + tokens.
- libs/board-editor/src/lib/local-storage-catalog-store.ts — `LocalStorageCatalogStore`:
  async methods over sync localStorage; single namespaced key (`studio.catalog-designer.v1`);
  corruption-safe read (malformed/absent -> empty, NEVER throws); quota errors PROPAGATE as
  rejected promises; "async even though localStorage is sync — the seam for a future
  HTTP/SubstrateClient adapter".
- libs/board-editor/src/lib/local-storage-catalog-store.spec.ts
  + libs/board-editor/src/lib/catalog-store-persistence.spec.ts — test patterns to copy
  (round-trip, corruption, quota, namespacing).
- apps/board-editor-ui/src/app/app.config.ts — `provideAppInitializer(() =>
  seedBuiltinRecipes(inject(CATALOG_STORE)))` + a "Reset" affordance; delete-respecting seed
  (one-time flag).

PHASE 0 — ORIENT + DESIGN (design-first)
1. Invoke the superpowers brainstorming skill. Read the files above + the studio-ui store/
   token/seed files. Confirm the consuming surfaces and the sync read path.
2. Write a SHORT design note (markdown in domains/studio/docs/ — a concept note, not
   necessarily a full ADR; if you judge it warrants an ADR, scaffold one in layers/specs via
   the adr-scaffolder skill). It must resolve these decisions (recommendations in [brackets];
   confirm or override with reasoning):
   - SYNC working copy + ASYNC write-through  [RECOMMENDED]. Keep InMemoryCatalogStore as the
     synchronous in-RAM working copy (so the ~8 consuming surfaces need NO async rewrite); add
     a separate ASYNC persistence port. On app init, async-LOAD the persisted catalog and seed
     the in-RAM store from it; on each mutation, async write-through (debounced ~250-500ms).
     Reject the alternative (make the whole store async) — large risky surface rewrite.
   - PORT SHAPE  [RECOMMENDED: a small `CatalogPersistencePort` with
     `load(): Promise<Catalog | null>`, `save(catalog: Catalog): Promise<void>`, `clear():
     Promise<void>`]. Async, corruption-safe, quota-propagating — mirror board-editor.
   - SEEDING / DELETE-RESPECT  [RECOMMENDED]. First run (empty storage) seeds `seedCatalog()`
     then persists; subsequent runs RESTORE the persisted catalog and DO NOT re-seed over it
     (respect a user who cleared items) — mirror board-editor's delete-respecting one-time-flag
     behavior.
   - VERSIONING / MIGRATION  [RECOMMENDED]. Persist `{ version: 1, catalog }`; on load, unknown/
     older version -> migrate or fall back to seed (never throw). board-editor has a v1->v2
     back-compat precedent to copy.
   - RESET AFFORDANCE  [RECOMMENDED: yes]. A "Reset to demo" control (mirror board-editor-ui's
     top-bar Reset) that clears storage + re-seeds — otherwise a user who edits has no escape
     hatch back to the demo.
   - WHAT TO PERSIST: the `Catalog` (8 item arrays) ONLY. NOT the derived relationship graph
     (ADR-176). NOT selection/view/geometry state.
3. Get the design note reviewed if it introduces a new port boundary (designer-first is for
   risky/new-port changes — a single app-local async port is borderline; a quick self-review +
   the verifier wave at PR time is likely enough, but flag it).

PHASE 1 — IMPLEMENT (TDD)
- Use the superpowers test-driven-development skill. localStorage IS available/mockable under
  vitest+jsdom, so the adapter is genuinely unit-testable (unlike CSS): write failing specs
  first — round-trip save/load, corruption-safe read, quota propagation, versioned blob,
  first-run-seed vs restore, delete-respect.
- Implement the async `CatalogPersistencePort` + a `LocalStorageCatalogPersistence` adapter
  (own namespaced key, e.g. `studio-ui.catalog.v1` — DISTINCT from board-editor's
  `studio.catalog-designer.v1`). Corruption-safe, async, quota-propagating.
- Wire it: keep InMemoryCatalogStore as the sync working copy. Add app-init load+seed
  (provideAppInitializer) + debounced write-through on mutation. The CATALOG_BROWSER_STORE
  factory becomes async-seeded (or a thin service owns the store + persistence). Keep the
  consuming surfaces' sync read API unchanged.
- Add the Reset affordance if the design note kept it.
- Keep it signal-native. studio-ui uses ZERO ReactiveFormsModule/CVA — do NOT add reactive
  forms (this is the confirmed studio-ui idiom; the global reactive-forms directive does not
  apply here).

BUILD, RUN & VERIFY (host gotchas — these WILL bite if skipped)
- After any git pull / fresh clone, studio-ui node_modules goes stale. Run `pnpm install` at
  domains/studio root, then BUILD the scenario-engine dist (studio-ui type-imports it):
  `cd libs/scenario-engine && ../../apps/studio-ui/node_modules/.bin/tsc -p tsconfig.build.json`.
  Confirm `@noble/hashes`, `zod`, `scenario-engine` resolve in apps/studio-ui/node_modules.
- `pnpm install` re-mangles pnpm-workspace.yaml (injects a `@nestjs/core: set this to true or
  false` allowBuilds placeholder). `git checkout pnpm-workspace.yaml` — NEVER stage it.
- DO NOT use `pnpm run ci:local` (broken on this host: pnpm verify-deps wall on @nestjs/core).
  Run gates via the app's ng directly:
    cd apps/studio-ui && node_modules/.bin/ng build
    node_modules/.bin/ng test --no-watch   (or --include='**/<area>/**/*.spec.ts')
- Serve to verify persistence: `cd apps/studio-ui && node_modules/.bin/ng serve --port 4291`.
  The catalog surfaces do NOT touch node:crypto, so plain `ng serve` is fine for this work.
  (Only the /model Run path needs the PROD build — `ng build` + `npx -y serve -s
  dist/studio-ui/browser` — because Vite externalizes node:crypto in dev-serve. Not relevant
  to catalog persistence, but don't be surprised by it.)
- ACCEPTANCE / manual verify: open the app, edit a Capability (e.g. rename "Drought
  resilience"), RELOAD -> the edit SURVIVES. Clear localStorage (or click Reset) -> catalog
  re-seeds to the demo. Confirm the derived-relationship views still compute (nothing persisted
  a graph).

GOVERNANCE (cluster rules — non-negotiable)
- Branch in domains/studio, PR to main. Founder-gated merge (do NOT self-merge; present the PR
  green + reviewed and ask).
- ADR-086: open a `type/story` issue in de-braighter/studio and put `Closes #<n>` in the PR body.
- Review floor: >=1 /code-review pass; this is non-trivial (new port + app-init wiring) so run
  the full verifier wave (reviewer + qa-engineer + charter-checker + local-ci, isolation:
  worktree).
- PR body must carry the twin lines:
    Producer: <producer>/<model> [brainstorming, test-driven-development]
    Effort: standard
    Effect: cycle-time 0.01±0.02 expert
    Effect: findings 2±2 expert
- After merge, run the SDLC-twin ritual for the PR (from domains/devloop):
    npx tsx src/cli.ts drain de-braighter/studio#<pr>
    npx tsx src/cli.ts backfill de-braighter/studio
    npx tsx src/cli.ts reconcile de-braighter/studio#<pr>

GUARDRAILS / DON'Ts
- ZERO kernel/substrate/design-system change. App-local persistence only.
- Don't rewrite the sync store API or the consuming surfaces — add persistence AROUND the
  in-RAM working copy.
- Don't persist the derived relationship graph (ADR-176) or view/selection state.
- Don't add ReactiveFormsModule/CVA (signal-native app).
- Don't commit pnpm-workspace.yaml churn; don't use `pnpm run ci:local`.

ACCEPTANCE CRITERIA
1. Editing any catalog item and reloading preserves the edit (localStorage).
2. First run (empty storage) seeds the demo; later runs restore the user catalog and don't
   re-seed over deletions.
3. Corrupt/absent/old-version storage never throws — falls back gracefully (seed or migrate).
4. Reset affordance clears + re-seeds.
5. The persistence layer is an ASYNC port with a localStorage adapter — a SubstrateClient
   adapter could replace it via the token with no surface change.
6. studio-ui prod build green + new adapter specs green + full suite green; verifier wave clean.
```

---

## Why this shape (notes for the requester, not part of the prompt)

- **Staged + sync-working-copy/async-write-through** is the low-risk path: it delivers
  "edits survive reload" without touching the ~8 surfaces that read the store synchronously,
  and the async port is the exact seam board-editor already proved, so a substrate adapter is a
  later drop-in.
- **localStorage is browser-local**, not server/shared — same caveat as board-editor. The real
  end-state (substrate-backed, tenant-scoped) remains a follow-up epic; this prompt explicitly
  leaves the async seam for it.
- The prompt front-loads the **host gotchas** (stale node_modules, scenario-engine tsc-build,
  `ci:local` broken, pnpm-workspace mangle, node:crypto dev-serve) that cost real cycles this
  session, so the fresh session doesn't rediscover them.
