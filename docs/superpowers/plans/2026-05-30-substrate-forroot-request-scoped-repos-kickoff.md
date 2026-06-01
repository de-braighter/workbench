# Next-session kickoff — substrate#55: forRoot binding for request-scoped repos (designer-first)

> Paste the `## PROMPT` block below into a fresh Claude Code session launched from `de-braighter/`.
> This is a kernel **composition-root contract** change → designer-first (substrate-architect), not a mechanical fix.
> The crux is a request-scope **cascade** question, not a one-line DI tweak — design before coding.

---

## PROMPT

We're tackling **substrate#55** — `SubstrateModule.forRoot` can't wire the DB-backed, **request-scoped** auth repos, which blocks the running-app DB-level-RLS path for packs. This is **designer-first**: it's a kernel composition-root *contract* change, so use the **substrate-architect** agent for the design, write a short concept/ADR, get it confirmed, then implement in `libs/substrate-runtime`.

**Before anything, recall context:** read the memories `pack-football-kernel-auth-integration-state` (the whole arc — substrate `runtime@0.10.1` published with the `core.*` SQL artifact + RLS proven; exercir#115 merged; this #55 is the one carried-forward gap), `substrate-kernel-2026-05-29-arc-state`, and `substrate-nx-vitest4-executor-and-worktree-daemon-lock` (local-gate gotchas). Launch from `de-braighter/` (cluster root); this work is in `layers/substrate/` (`libs/substrate-runtime`). **Use a git worktree** (`layers/substrate/.worktrees/<branch>`); `.worktrees/` is gitignored there.

### The problem (substrate#55)

`forRoot({ packRoleAssignmentRepository, consentReceiptRepository })` binds those options as **`useValue: new Repo()`** — it constructs the repo **once, zero-arg, at module-config time** (`composition-root/substrate.module.js` ~lines 209-248, a shape-check that calls the class or `new`s it). That works for the in-memory repos (zero-arg ctors) but **not** for `PrismaPackRoleAssignmentRepository` / `PrismaConsentReceiptRepository`: they inject **`ScopedPrismaService`** (REQUEST-scoped — it sets the `app.tenant_pack_id` GUC per request via `set_config(...,true)`). `new PrismaPackRoleAssignmentRepository()` yields a singleton with `undefined` scoped-prisma → broken. So the contract structurally can't wire a request-scoped repo.

Consequence: the DB-level RLS *invariant* is proven (exercir#112's DB-gated spec constructs the repo + an app-role client directly), but the *running app* can't serve PolicyEngine/ConsentEngine off the DB-backed repos under RLS. exercir's `PACK_FOOTBALL_KERNEL_DB_AUTH` flag is currently a no-op.

### The design crux — study FIRST, before choosing a binding mechanism

The real question is **request-scope cascade**, not just "use `useClass` instead of `useValue`". If the repo becomes request-scoped (because it injects request-scoped `ScopedPrismaService`), then `PolicyEngine` / `ConsentEngine` (which inject the repo) and the guards (`PolicyGuard` / `ConsentGuard`, registered as `APP_GUARD`) may **cascade to request scope** — with per-request instantiation cost and `APP_GUARD`-scoping implications.

So the FIRST design task: **find how substrate itself already flows request-scoped Prisma data into its singleton engines.** `ScopedPrismaService` is request-scoped and already used (substrate#41 WORM/RLS path, the audit repo). Determine the existing pattern — does the engine resolve the repo per-request (e.g. via `ModuleRef.resolve`), is the whole chain intentionally request-scoped, or does `ScopedPrismaService` get resolved lazily per call? That precedent decides the fix. Don't design in a vacuum — mirror what's already there.

### Design options to evaluate (in the concept doc)

1. **`useClass` DI binding** — bind the repo class via `useClass` into `SubstrateModule`'s injector so Nest constructs it (resolving `ScopedPrismaService`). Needs `forRoot` to distinguish "bind this class via DI" from the current "instance / zero-arg factory" path (and to keep in-memory repos working). Watch the scope cascade into the engines/guards.
2. **`extraProviders` escape hatch** — let the consumer pass NestJS `Provider[]` that `forRoot` spreads into the module (so the pack binds `{ provide: PACK_ROLE_ASSIGNMENT_REPOSITORY, useClass: PrismaPackRoleAssignmentRepository }` + the `PRISMA_CLIENT` app-role client itself). Most flexible, least kernel opinion; verify the engines pick up the override token.
3. **Per-request resolution inside the engine** — keep engines singleton; have them resolve the repo (or `ScopedPrismaService`) per call via `ModuleRef` keyed on the request. Avoids the cascade but adds engine complexity.

Pick the one that (a) preserves singleton engines/guards where possible, (b) keeps the in-memory default path unchanged, (c) matches the existing substrate request-scoped pattern, (d) stays minimal per ADR-176.

### Substrate conventions (carry cold)

`Promise<Result<T,Error>>` at port boundaries (no throws); ESM imports with explicit `.js`; single `SubstrateModule` + `forRoot({...})` composition; `ScopedPrismaService` GUC plumbing (ADR-027 §6); plain-`Symbol`/`Symbol.for` DI tokens; contracts package has zero NestJS dep. Don't grow the kernel — this is a runtime composition change, not a new contract/primitive (ADR-176 inclusion test: it's runtime wiring, stays in `substrate-runtime`).

### Verification + ship

- Substrate gate (worktree, **vitest CLI** not `nx test` — the `@nx/vitest` executor gotcha): `nx build substrate-runtime`, the new wiring test, `nx lint`.
- New test: prove a request-scoped repo bound via the new path **actually resolves `ScopedPrismaService` + the GUC flows per request** (a Nest TestingModule that boots `forRoot` with the Prisma repos + a stub request context; assert two requests with different `tenantPackId` get isolated reads). DB-gated (`.skipIf` dual-URL) for the real-RLS leg, mirroring substrate#41.
- **Bump + publish** a new immutable `@de-braighter/substrate-runtime` version. **Re-check the registry / `origin/main` for the latest published version first** — 0.10.1 was latest as of 2026-05-29, but another session may have bumped it; your version is the NEXT free one, not an assumed number. Publish flow: `npm run publish:runtime` from the substrate checkout (needs `GITHUB_TOKEN` w/ `write:packages` + the root `.npmrc`; CI publish is billing-frozen → manual). Publish from a checkout that HAS `node_modules` (the main checkout may not — publish from the worktree if so).

### Then exercir (flip the flag)

In a `domains/exercir` worktree: bump the substrate dep to the new version; wire the DB-backed repos in `apps/pack-football-api/src/app/app.module.ts` behind `PACK_FOOTBALL_KERNEL_DB_AUTH` (now actually possible) using the new forRoot mechanism + the app-role `PrismaClient` (`SUBSTRATE_APP_DATABASE_URL`) + `ScopedPrismaService`; add an **app-level** DB-gated enforcement test (HTTP, through the real guard cascade, DB-backed) extending `pack-football-authz-enforcement.spec.ts` — grant in tenant A, hit a route as tenant B, assert 403/empty via the real RLS path. Update the `.env.example` comment (the flag is live now).

### Cross-cutting gotchas (from the arc)

- **Cross-workspace build:** a substrate *version* bump ripples into ALL consuming nx projects — when exercir bumps, gate `nx run-many -t build` across the WHOLE workspace (pack-football, **-ui**, -api, -visual-editor), not just the obvious two. (The contracts bump broke pack-football-ui last time.)
- **Run the real thing:** for SQL/RLS/DB work, the apply-it-as-the-`app`-role test caught a missing grant the static checks missed twice. Stand up the dev DB (`docker compose up -d` + `db:setup:core`) and exercise the actual role.
- Fresh worktree: `npm install` (needs `GITHUB_TOKEN`) then `npm run db:generate` (else TS4111 on `$disconnect`). Worktree teardown: `nx daemon --stop` → `rm -rf .worktrees/<name>` → `git worktree prune`. Verifier wave (read-only, against the committed diff): reviewer + charter-checker + qa-engineer (+ exercir-charter-checker on the exercir PR). PR-gated everywhere; never bypass pre-push hooks. `gh pr edit` fails (token lacks `read:org`) — use `gh pr comment`/`create`.

### First moves

1. Recall the memories above.
2. Read `composition-root/substrate.module.{ts,js}` (the `forRoot` repo-binding + the providers/exports arrays), `scoped-prisma/scoped-prisma.service.ts`, the Prisma repos' constructors, and **how the engines/guards consume the repos + how substrate#41 flows request-scoped Prisma into singletons** — that precedent decides the design.
3. Surface a short concept/ADR (the chosen binding mechanism + the scope-cascade decision) for confirmation BEFORE coding.
4. Implement → gate → publish → flip exercir's flag → app-level DB-gated test → PR each side.
