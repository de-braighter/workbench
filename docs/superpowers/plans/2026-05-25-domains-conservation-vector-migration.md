# Plan — migrate the conservation domain into the cluster (step 7)

**Status:** READY TO EXECUTE pending the founder decisions flagged below.
**Date:** 2026-05-25. **Migration step:** 7 (the last domain still living in
the old `D:/development/projects/braighter/` parent).

This is the only thing left in the pre-migration parent (everything else
was reclaimed or git-backed in the cleanup sweep). It is a clean working tree,
fully pushed (zero unpushed commits), pnpm + Nx, with **no `@braighter-io/*`
references and no `file:` deps** — so it does not carry the rot the exercir
migration hit.

## The domain (assessed 2026-05-25)

| | **Conservation** |
|---|---|
| Local path | `braighter/substrate-continuum` |
| Remote | `braighter-io/substrate-continuum-conservation` |
| Purpose | Conservation-genetics SaaS; lineage-DAG, simulation-first |
| Shape | Greenfield: 2 libs (`contracts`,`runtime`) + `api` + `web`; ~2–3k LOC/lib |
| Substrate relation | **AUTHORS** its own `@substrate-continuum/{contracts,runtime}` (workspace:*) |
| Governance docs | `.claude/CLAUDE.md` (good) |
| Build | pnpm + Nx; `build`/`test`/`typecheck` |

**Sibling note:** `braighter/substrate_wb/substrate` (remote `braighter-io/substrate`)
is the kernel-substrate checkout — it's the source
of the published `@de-braighter/substrate-*` (already in `layers/substrate`). It's
a duplicate checkout to retire separately, not part of this migration.

## Why this is NOT the exercir recipe

The exercir migration was *consumer lockstep*: switch `file:` substrate deps →
published `^0.3.x`/`^0.4.x`. Conservation does not consume the layer substrate —
it authors its own (confusingly same-named) substrate. So the migration is
**relocate + re-scope + build-green + governance-doc**, with no published-dep
wiring.

## FOUNDER DECISIONS NEEDED (decide before executing)

1. **Cluster location + repo identity.** Recommend `de-braighter/domains/conservation`
   (short, parallels `domains/exercir`). The
   GitHub repo keeps its name (`substrate-continuum-conservation`)
   via the gitignored-sibling-clone model, OR gets renamed to
   `conservation` for consistency. **Naming-collision risk:** the repo
   currently carries `substrate-continuum` in its name — the cluster CLAUDE.md
   already warns about this; renaming removes the foot-gun.
2. **Scope rename target.** It uses `@substrate-continuum/*` internally. To what?
   - Conservation: `@de-braighter/conservation-{contracts,runtime}` (keeps the
     author-of-its-own-substrate identity explicit).
3. **Conservation: publish or stay internal?** It authors substrate libs. If other
   cluster code will ever consume them, set up `.npmrc` + `publish:libs` + version
   bumping (the `layers/substrate` pattern). If solo for now, keep internal
   (`workspace:*`) and defer publishing. Recommend: **internal for now** (greenfield,
   no consumers).

## Execution recipe (conservation)

1. **Clone** the repo into `de-braighter/domains/conservation` (gitignored sibling,
   like `domains/exercir`); update the git remote to `de-braighter/*`.
2. **Re-scope** `@substrate-continuum/*` → the chosen `@de-braighter/*` scope across
   `package.json` names + deps, `tsconfig.base.json` paths, `eslint.config.*`
   boundary tags, and imports. (Mechanical, codemod-style — same approach as the
   db- rename.)
3. **`pnpm install`** then **build the full graph green** —
   `pnpm nx run-many -t build typecheck test lint`. **Budget for build rot:** a fresh
   clone + full test run is what surfaced the temporal-coupling + readFileSync-path
   bugs in exercir; expect 0–2 similar de-rot fixes.
4. **Governance doc:** conservation already has `.claude/CLAUDE.md` (update paths
   only).
5. **PR-gated** per repo. Verify green locally (gh CI down — local green is the gate).
   Use `--parallel=1` for full test runs.
6. **Conservation web app caveat:** check `apps/web` for hardcoded `braighter-io`
   API URLs / refs before merge (the only spot the assessment flagged as unchecked).

## After it lands

- Delete the old `braighter/` parent's `substrate-continuum` + `substrate_wb`
  checkouts (bundle-first if any unpushed work appears — none currently). That
  empties the old parent entirely → migration structurally complete.
- Retire the duplicate `braighter/substrate_wb/substrate` kernel checkout
  (superseded by `layers/substrate`).
- Update the cluster `CLAUDE.md` naming-collision warning once the repo is renamed.

## Verification gate (definition of done)

- [ ] Cloned into `domains/conservation`, remote on `de-braighter/*`
- [ ] Zero `@substrate-continuum/*` (or `@braighter-io/*`) residual in source
- [ ] `nx run-many -t build typecheck test lint` green
- [ ] Governance doc present + path-accurate
- [ ] PR opened, local-green evidence in the body
