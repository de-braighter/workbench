# Next-session kickoff — exercir: flip `PACK_FOOTBALL_KERNEL_DB_AUTH` onto the DB-backed auth repos (substrate 0.11.0 / ADR-197)

> Paste the `## PROMPT` block below into a fresh Claude Code session launched from `de-braighter/`.
> This is the **consumer side** of the substrate#55 arc. The substrate side is DONE + PUBLISHED
> (`@de-braighter/substrate-runtime@0.11.0`, immutable). This session is mostly mechanical wiring
> + an app-level DB-gated test — NOT designer-first. The design is already locked in ADR-197.

---

## PROMPT

We're finishing the **substrate#55 / ADR-197** arc on the **exercir** side: flip the
`PACK_FOOTBALL_KERNEL_DB_AUTH` flag (currently a no-op) so pack-football's running app serves
`PolicyEngine` / `ConsentEngine` off the **DB-backed** auth repos under real Postgres RLS, using
the new `GucPrismaRunner` wiring that substrate 0.11.0 now ships. This is consumer wiring + a
DB-gated enforcement test, not a design task.

**Before anything, recall context:** read the memories `substrate-55-forroot-db-auth-wiring-state`
(the whole arc — what shipped in substrate 0.11.0, the new `forRoot` posture, the NEXT-session
plan), `pack-football-kernel-auth-integration-state` (the exercir DB-RLS foundation that already
landed in exercir#115: docker-compose :5545, `db:setup:core`, the `.env.example` flag, the
`@TenantContext()` decorator gotcha, the `@Inject(engine)`-required gotcha), and
`substrate-nx-vitest4-executor-and-worktree-daemon-lock` (local-gate gotchas). Launch from
`de-braighter/` (cluster root); this work is in `domains/exercir/`. **Use a git worktree**
(`domains/exercir/.worktrees/<branch>`; `.worktrees/` is gitignored there).

### What substrate already shipped (do NOT re-do)

`@de-braighter/substrate-runtime@0.11.0` is **published + immutable**. It exports a singleton
`GucPrismaRunner` (`run(tenantPackId, fn)` — opens one `$transaction`, sets the tx-local
`app.tenant_pack_id` GUC from the supplied `tenantPackId`, runs `fn` on that tx). The DB-backed
auth repos (`PrismaPackRoleAssignmentRepository`, `PrismaConsentReceiptRepository`) now take a
`GucPrismaRunner` in their ctor. The **new production posture** (ADR-197) is to pass a constructed
instance through `forRoot` so the engines + APP_GUARDs stay singleton (no `Scope.REQUEST` cascade):

```ts
SubstrateModule.forRoot({
  prismaClient: appRoleClient,           // a PrismaClient over SUBSTRATE_APP_DATABASE_URL
  manifests: [PACK_FOOTBALL_MANIFEST],
  packRoleAssignmentRepository:
    new PrismaPackRoleAssignmentRepository(new GucPrismaRunner(appRoleClient)),
  consentReceiptRepository:
    new PrismaConsentReceiptRepository(new GucPrismaRunner(appRoleClient)),
})
```

**Do NOT** use the old `providers: [{ provide: TOKEN, useClass: PrismaRepo }]` snippet — it is
silently broken (the `global:true` SubstrateModule's engines resolve the token against their own
provider array; a consumer-side binding is invisible to them — that's ADR-197 §4, the whole reason
#55 existed). The override MUST come through `forRoot`.

Substrate PRs open + verifier-green (founder may merge before this session): specs#233 (ADR-197),
substrate#56 (impl). Follow-up substrate#57 (consolidation) is NOT this session's work.

### The exercir DB-RLS foundation already exists (exercir#115, merged)

`domains/exercir` already has: `docker-compose.yml` (exercir-postgres pg16 :5545), `.env.example`
(`DATABASE_URL` admin + `SUBSTRATE_APP_DATABASE_URL` app-role + `PACK_FOOTBALL_KERNEL_DB_AUTH`
flag), scripts `db:up`/`db:down`/`db:setup:core` (applies the published `core.*` SQL artifact via
`prisma db execute`). DB-level cross-tenant RLS was already EMPIRICALLY PROVEN at the substrate
layer on a fresh volume. So the schema + roles + app-role client URL are all in place — this
session just wires the running app to use them.

### The work (this session)

1. **New worktree** `domains/exercir/.worktrees/<branch>`; `npm install` (needs `GITHUB_TOKEN`) +
   `npm run db:generate` (else TS4111 on `$disconnect`).
2. **Bump the substrate-runtime dep → `^0.11.0`** everywhere it's pinned: root `package.json`,
   `libs/pack-football`, `libs/pack-football-ui` (peer), `apps/pack-football-api`. `npm install`
   (watch ERESOLVE — bump the pack-football-ui peer too, as happened with the 0.10.1 bump). Note:
   contracts stays `^0.8.0` (unchanged — only runtime bumped).
3. **Wire the DB-backed repos behind the flag** in `apps/pack-football-api/src/app/app.module.ts`:
   when `PACK_FOOTBALL_KERNEL_DB_AUTH` is true, build an app-role `PrismaClient` over
   `SUBSTRATE_APP_DATABASE_URL` + a `GucPrismaRunner` over it, and pass the two constructed Prisma
   repos through `forRoot` (snippet above). When the flag is false, keep the current in-memory
   default path unchanged. Keep `@Inject(PolicyEngine)`/`@Inject(ConsentEngine)` explicit
   (required here — see the memory). Set `SUBSTRATE_RLS_ENABLED=true` on the DB-auth path.
4. **Update `.env.example`** — the flag is live now; drop/replace any "no-op / not yet wired" note.
5. **App-level DB-gated enforcement test** — extend
   `apps/pack-football-api/src/app/pack-football-authz-enforcement.spec.ts` (or a sibling spec) with
   an HTTP test that boots AppModule with the flag ON + the app-role client, grants a role in
   tenant A, then hits a decorated route **as tenant B** and asserts 403/empty via the **real guard
   cascade + real RLS path** (not the in-memory repos). Gate it `.skipIf` on the dual-URL
   (`SUBSTRATE_APP_DATABASE_URL` + admin `DATABASE_URL`), mirroring substrate#41 / the substrate
   wiring spec's leg C, so CI-without-DB stays green. Actually RUN it: `db:up` + `db:setup:core` +
   the dual URLs, prove it red→green (the apply-it-as-`app` discipline caught missing grants twice).
6. **Gate the WHOLE workspace** — a substrate version bump ripples into ALL consuming nx projects:
   `nx run-many -t build` across pack-football, **pack-football-ui**, pack-football-api,
   pack-football-visual-editor (the contracts bump broke pack-football-ui last time). Plus
   `nx run-many -t test` (vitest CLI per the executor gotcha) + lint.
7. **Verifier wave** (read-only, against the committed diff): reviewer + charter-checker +
   qa-engineer + **exercir-charter-checker** (it joins on `domains/exercir/` PRs). PR. Likely
   `Closes #112` (the DB-level RLS enforcement infra arc).

### Gotchas (carry cold)

- **`@TenantContext()` param decorator, NOT ctor injection** for the request-scoped
  `TENANT_PACK_CONTEXT` in controllers (else "requested before TenantPackContextGuard ran"). Lives
  in `apps/pack-football-api/src/app/tenant-context.decorator.ts`.
- **`@Inject(PolicyEngine)`/`@Inject(ConsentEngine)` REQUIRED** in the exercir api (this app doesn't
  emit class-token metadata; without it the engine injects `undefined` → `app.init()` cascade-fail).
- exercir consumes substrate ONLY via GitHub Packages — the 0.11.0 bump is the hand-off; no `file:`
  link.
- vitest CLI not `nx test`; fresh worktree needs `npm run db:generate` before building
  pack-football-api. Worktree teardown: `nx daemon --stop` → `rm -rf .worktrees/<name>` →
  `git worktree prune`. `gh pr edit` fails (no read:org) — use `gh pr comment`/`create`.
- After merging, also remember the substrate worktree teardown: `layers/substrate/.worktrees/forroot-55`
  is left intact pending substrate#56 merge (daemon already stopped).

### First moves

1. Recall the three memories above.
2. Confirm `@de-braighter/substrate-runtime@0.11.0` is the published latest (`npm view`); check
   whether substrate#56 / specs#233 merged.
3. New exercir worktree → bump deps → install → `db:generate`.
4. Wire `app.module.ts` behind the flag → `.env.example` → app-level DB-gated test (run it for real
   against `:5545`) → whole-workspace gate → verifier wave → PR.
