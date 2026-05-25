# Plan — migrate the conservation + vector domains into the cluster (step 7)

**Status:** READY TO EXECUTE pending the founder decisions flagged below.
**Date:** 2026-05-25. **Migration step:** 7 (the last two domains still living in
the old `D:/development/projects/braighter/` parent).

These are the only two things left in the pre-migration parent (everything else
was reclaimed or git-backed in the cleanup sweep). Both are clean working trees,
fully pushed (zero unpushed commits), pnpm + Nx, with **no `@braighter-io/*`
references and no `file:` deps** — so neither carries the rot the exercir
migration hit.

## The two domains (assessed 2026-05-25)

| | **Conservation** | **Vector** |
|---|---|---|
| Local path | `braighter/substrate-continuum` | `braighter/substrate_wb/substrate-continuum` |
| Remote | `braighter-io/substrate-continuum-conservation` | `braighter-io/substrate-continuum` |
| Purpose | Conservation-genetics SaaS; lineage-DAG, simulation-first | Vector visual OS (SVG/renderers/spatial medium) |
| Shape | Greenfield: 2 libs (`contracts`,`runtime`) + `api` + `web`; ~2–3k LOC/lib | Mature: 12 packages + tooling; ~10–15k LOC; 6-layer governance |
| Substrate relation | **AUTHORS** its own `@substrate-continuum/{contracts,runtime}` (workspace:*) | **Orthogonal** — does not touch kernel substrate; internal-only, no publish |
| Governance docs | `.claude/CLAUDE.md` (good) | `AGENTS.md` (strict boundaries); no CLAUDE.md |
| Build | pnpm + Nx; `build`/`test`/`typecheck` | pnpm + Nx 19.8; `build`/`test`/`lint`/`typecheck`/`api-check`/`boundary-check` |

**Sibling note:** `braighter/substrate_wb/substrate` (remote `braighter-io/substrate`)
is the kernel-substrate checkout, NOT part of the vector domain — it's the source
of the published `@de-braighter/substrate-*` (already in `layers/substrate`). Do
NOT fold it into the vector migration; it's a duplicate checkout to retire
separately.

## Why this is NOT the exercir recipe

The exercir migration was *consumer lockstep*: switch `file:` substrate deps →
published `^0.3.x`/`^0.4.x`. Neither domain here consumes the layer substrate —
conservation authors its own (confusingly same-named) substrate; vector is a
different axis entirely. So the migration is **relocate + re-scope + build-green +
governance-doc**, with no published-dep wiring.

## FOUNDER DECISIONS NEEDED (decide before executing)

1. **Cluster location + repo identity.** Recommend `de-braighter/domains/conservation`
   and `de-braighter/domains/vector` (short, parallels `domains/exercir`). The
   GitHub repos keep their names (`substrate-continuum-conservation`,
   `substrate-continuum`) via the gitignored-sibling-clone model, OR get renamed to
   `conservation`/`vector` for consistency. **Naming-collision risk:** both repos
   currently carry `substrate-continuum` in their name — the cluster CLAUDE.md
   already warns about this; renaming removes the foot-gun.
2. **Scope rename target.** Both use `@substrate-continuum/*` internally. To what?
   - Conservation: `@de-braighter/conservation-{contracts,runtime}` (keeps the
     author-of-its-own-substrate identity explicit).
   - Vector: `@de-braighter/vector-*` (or keep `@substrate-continuum/*` if staying
     fully internal — the scope only matters if published).
3. **Conservation: publish or stay internal?** It authors substrate libs. If other
   cluster code will ever consume them, set up `.npmrc` + `publish:libs` + version
   bumping (the `layers/substrate` pattern). If solo for now, keep internal
   (`workspace:*`) and defer publishing. Recommend: **internal for now** (greenfield,
   no consumers).
4. **Vector governance.** Its `@nx/enforce-module-boundaries` layer/scope rules are
   self-contained today. Keep them vector-scoped (recommended — zero cluster impact)
   vs. merge into cluster-level boundary governance.

## Execution recipe (per domain, conservation first — it's simpler)

1. **Clone** the repo into `de-braighter/domains/<name>` (gitignored sibling, like
   `domains/exercir`); update the git remote to `de-braighter/*`.
2. **Re-scope** `@substrate-continuum/*` → the chosen `@de-braighter/*` scope across
   `package.json` names + deps, `tsconfig.base.json` paths, `eslint.config.*`
   boundary tags, and imports. (Mechanical, codemod-style — same approach as the
   db- rename.)
3. **`pnpm install`** then **build the full graph green** —
   `pnpm nx run-many -t build typecheck test lint` (vector adds `api-check`
   `boundary-check`). **Budget for build rot:** a fresh clone + full test run is what
   surfaced the temporal-coupling + readFileSync-path bugs in exercir; expect 0–2
   similar de-rot fixes.
4. **Governance doc:** conservation already has `.claude/CLAUDE.md` (update paths
   only); vector needs a short `CLAUDE.md` (one-liner pointing at its `AGENTS.md`).
5. **PR-gated** per repo. Verify green locally (gh CI down — local green is the gate).
   Use `--parallel=1` for full test runs.
6. **Conservation web app caveat:** check `apps/web` for hardcoded `braighter-io`
   API URLs / refs before merge (the only spot the assessment flagged as unchecked).

## After both land

- Delete the old `braighter/` parent's `substrate-continuum` + `substrate_wb`
  checkouts (bundle-first if any unpushed work appears — none currently). That
  empties the old parent entirely → migration structurally complete.
- Retire the duplicate `braighter/substrate_wb/substrate` kernel checkout
  (superseded by `layers/substrate`).
- Update the cluster `CLAUDE.md` naming-collision warning once the repos are renamed.

## Verification gate (definition of done, per domain)

- [ ] Cloned into `domains/<name>`, remote on `de-braighter/*`
- [ ] Zero `@substrate-continuum/*` (or `@braighter-io/*`) residual in source
- [ ] `nx run-many -t build typecheck test lint [api-check boundary-check]` green
- [ ] Governance doc present + path-accurate
- [ ] PR opened, local-green evidence in the body
